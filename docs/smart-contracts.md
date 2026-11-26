# Smart contracts

All contracts use Solidity `^0.8.24` (compiled with 0.8.24, EVM `cancun`) and OpenZeppelin Contracts 5.x. Source: `blockchain/contracts/`.

## Deployment & wiring

```
RoleManager(admin)
UserRegistry(roleManager)               → roleManager.setUserRegistry(userRegistry)   (one-time)
ProductRegistry(roleManager)
SupplyChainTracker(roleManager, productRegistry) → productRegistry.setTracker(tracker) (one-time)
FarmChainTestToken(admin, 1_000_000e18)  (test-only fUSD)
PaymentEscrow(token, roleManager, productRegistry)
```

## Shared types (`libraries/FarmChainTypes.sol`)

- `Role`: `None, Farmer, Distributor, Warehouse, Retailer`
- `Stage`: `HARVESTED, REGISTERED, IN_TRANSIT, AT_WAREHOUSE, QUALITY_CHECKED, OUT_FOR_DELIVERY, AT_RETAILER, AVAILABLE_FOR_SALE, SOLD, RECALLED` (spec stages 1–10 = enum 0–9)
- `VerificationStatus`: `Unverified (pending), Verified, Rejected, Revoked`

## RoleManager — single authorization system

OpenZeppelin `AccessControl`. Roles: `DEFAULT_ADMIN_ROLE`, `FARMER_ROLE`, `DISTRIBUTOR_ROLE`, `WAREHOUSE_ROLE`, `RETAILER_ROLE`. Every other contract asks RoleManager. There is no second permission system.

| Function | Access | Notes |
|---|---|---|
| `verifyParticipant(account)` | admin | account must be registered; grants the role it **requested** in UserRegistry |
| `rejectParticipant(account, reason)` | admin | pending/rejected/revoked only |
| `revokeVerification(account, reason)` | admin | removes **all** participant roles |
| `grantParticipantRole(account, role)` / `revokeParticipantRole` | admin | participant roles only; account must be verified |
| `grantRole` / `revokeRole` | role admin | **reverts for participant roles** (`UseParticipantRoleFunctions`) so verification can't be bypassed |
| `isVerifiedParticipant`, `hasVerifiedRole`, `verificationStatus`, `isAdmin`, `roleFor` | view | |

Events: `ParticipantVerified`, `ParticipantRejected`, `VerificationRevoked`, `ParticipantRoleGranted`, `ParticipantRoleRevoked`, `UserRegistryConfigured` (+ OZ `RoleGranted/RoleRevoked`).

## UserRegistry

Public profile only: `wallet, name, organization, location, role (requested), registeredAt, updatedAt`. Field limit: 128 bytes.

| Function | Notes |
|---|---|
| `registerUser(name, org, location, role)` | once per wallet; `role != None`; grants nothing |
| `updateUserProfile(name, org, location)` | role cannot change |
| `getUser(addr)` | returns profile + `verification` + `roleActive` |
| `isRegistered`, `getUserRole`, `totalUsers`, `getUsers(offset, limit)` | views |

Events: `UserRegistered(account, role, name, ts)`, `UserProfileUpdated`.

## ProductRegistry

Batch fields: `id, farmer, productName, category, quantity, unit, harvestDate, farmLocation, metadataCID, createdAt, currentOwner, status`.

| Function | Access | Rules |
|---|---|---|
| `registerBatch(expectedBatchId, input)` | verified farmer | `expectedBatchId == nextBatchId` (IDs start at 10001); non-empty name/category/unit/location; quantity > 0; `0 < harvestDate ≤ now + 1 day`; `metadataCID` unique if non-empty; status `REGISTERED`, owner = farmer; calls `tracker.onBatchRegistered` |
| `updateBatchMetadata(id, cid)` | original farmer, still verified | only while farmer owns it, status `REGISTERED`, no pending transfer; new CID unique; old CID kept in event + history |
| `setOwner`, `setStatus` | **tracker only** | |
| `pause` / `unpause` | admin | blocks registration / metadata updates |
| `getBatch`, `getFarmerBatches`, `getBatchOwner`, `getBatchFarmer`, `getBatchStatus`, `batchExists`, `totalBatches` | view | |

Duplicate protection: sequential IDs, the expected-ID check and metadata-CID uniqueness. Nobody, not even the admin, can overwrite a batch.

Events: `BatchRegistered`, `BatchMetadataUpdated`, `BatchOwnerChanged`, `BatchStatusChanged`, `TrackerConfigured`.

## SupplyChainTracker

Append-only `HistoryEntry { batchId, action, stage, previousOwner, newOwner, actor, timestamp, location, metadataCID }` plus one `PendingTransfer` per batch.

### Custody rules (all parties verified)

| From | May offer custody to |
|---|---|
| Farmer | Distributor |
| Distributor | Warehouse, Retailer |
| Warehouse | Retailer, Distributor |
| Retailer | — (sells) |

Transfers are blocked for `SOLD`/`RECALLED` and retail stages, and while another transfer is pending. Ownership changes **only** in `acceptTransfer`, which re-checks both parties' verification.

| Function | Caller | Resulting stage |
|---|---|---|
| `initiateTransfer(id, to, location, cid)` | owner | unchanged |
| `acceptTransfer(id)` | recipient | unchanged (owner changes) |
| `rejectTransfer(id, reason)` | recipient | unchanged |
| `cancelTransfer(id)` | sender | unchanged |
| `recordShipment(id, location, cid)` | owner + distributor | `IN_TRANSIT` |
| `recordWarehouseArrival(id, storageLocation, cid)` | owner + warehouse | `AT_WAREHOUSE` |
| `recordQualityInspection(id, passed, location, reportCID)` | owner + warehouse, stage AT_WAREHOUSE/QUALITY_CHECKED | `QUALITY_CHECKED` |
| `recordRetailArrival(id, location, cid)` | owner + retailer | `AT_RETAILER` |
| `updateBatchStatus(id, OUT_FOR_DELIVERY, …)` | owner + distributor/warehouse | `OUT_FOR_DELIVERY` |
| `updateBatchStatus(id, AVAILABLE_FOR_SALE, …)` | owner + retailer, from AT_RETAILER | `AVAILABLE_FOR_SALE` |
| `updateBatchStatus(id, SOLD, …)` | owner + retailer, from AVAILABLE_FOR_SALE | `SOLD` |
| `updateBatchStatus(id, RECALLED, …)` | admin or original farmer, works while paused, cancels any pending transfer | `RECALLED` |

Views: `getBatchHistory`, `getHistoryLength`, `getHistoryEntry`, `getPendingTransfer`, `hasPendingTransfer`, `getParticipantBatches(addr)` (every batch an address held or was offered), `canTransfer(from, to)`.

Events (every entry emits the first two):
- `HistoryRecorded(batchId, index, actor, action, stage, previousOwner, newOwner, location, metadataCID, timestamp)`
- `BatchStageUpdated(batchId, updatedBy, stage, timestamp)`
- `TransferInitiated`, `TransferAccepted`, `BatchTransferred`, `TransferRejected`, `TransferCancelled`, `QualityInspectionRecorded`

The `Harvested` entry's timestamp is the farmer-declared harvest date. The chain proves who declared it and when it was recorded.

## PaymentEscrow

ERC-20 escrow (`SafeERC20`, `ReentrancyGuard`, `Pausable`). Order: `id, batchId, buyer, seller, amount, createdAt, fundedAt, deliveryWindow, deliveryDeadline, deliveredAt, status, deliveryConfirmed`. Status: `Created → Funded → Released | Refunded`, or `Created → Cancelled`.

| Function | Caller | Rules |
|---|---|---|
| `createOrder(batchId, seller, amount, window)` | verified buyer | seller verified and **current owner**; buyer ≠ seller; amount > 0; window 1 h–180 days; batch not SOLD/RECALLED; **one open order per batch** |
| `depositPayment(orderId)` | buyer | status Created → Funded (state set **before** `safeTransferFrom`); deadline = now + window; second deposit reverts (double-payment protection) |
| `confirmDelivery(orderId)` | buyer | releases to seller immediately |
| `releasePayment(orderId)` | buyer or seller | only if buyer **owns the batch on-chain** (custody accepted) |
| `requestRefund(orderId)` | seller: any time while Funded; buyer: only after `deliveryDeadline` **and** if custody was never transferred | refunds buyer |
| `cancelOrder(orderId)` | buyer or seller | only while Created (unfunded) |
| `pause`/`unpause` | admin | blocks **only** `createOrder` and `depositPayment` |

There is **no admin withdrawal**: tokens can only go to the order's seller or buyer.

Events: `OrderCreated`, `PaymentDeposited`, `DeliveryConfirmed`, `PaymentReleased`, `PaymentRefunded`, `OrderCancelled`.

### FarmChainTestToken (fUSD)

Test-only ERC-20 with no value. `faucet()` mints 10,000 fUSD per address per hour. Never use it as a production payment token.

## Tests

`blockchain/test/` — 61 tests covering every required case (registration, unauthorized role assignment, batch registration, duplicate prevention, unauthorized modification, valid/invalid transfers, acceptance, full journey, unauthorized status updates, escrow deposit/release, double payment, refunds, admin verification) plus edge cases: revoked participants, pausing, recall, field limits, and a malicious re-entrant ERC-20 (`contracts/test/ReentrantToken.sol`).

```
npx hardhat test       # 61 passing
npx hardhat coverage   # 100% statements on RoleManager, ProductRegistry, SupplyChainTracker, PaymentEscrow
```
