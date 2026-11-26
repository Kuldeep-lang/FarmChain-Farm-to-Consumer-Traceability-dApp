# FarmChain architecture

## Components

```
                    ┌──────────────────────────── Browser ────────────────────────────┐
                    │ React DApp (Vite)                                               │
                    │  • WalletContext (EIP-1193 / MetaMask)  • TanStack Query         │
                    │  • blockchain/reads.ts  (read-only JsonRpcProvider – no wallet)  │
                    │  • useTransaction (wallet → submitted → pending → confirmed)    │
                    └───────┬──────────────────────────────┬──────────────────────────┘
             ethers v6 /    │ writes signed in MetaMask    │ REST (fetch)
             JSON-RPC       ▼                              ▼
   ┌──────────────────────────────────────┐   ┌─────────────────────────────────────────┐
   │ Ethereum (Hardhat 31337 / Sepolia)   │   │ Express API                             │
   │  RoleManager ◄── UserRegistry        │   │  /auth  wallet-signature → JWT          │
   │      ▲  ▲                            │◄──┤  /users /admin (admin = on-chain check) │
   │      │  └── ProductRegistry ◄──┐     │   │  /ipfs  Multer → Pinata | Kubo          │
   │      │          ▲  hooks       │     │   │  /products /transactions /stats (index) │
   │      │   SupplyChainTracker ───┘     │   │  EventIndexer (eth_getLogs polling)     │
   │      └── PaymentEscrow ── fUSD ERC20 │   └──────────┬──────────────────┬───────────┘
   └──────────────────────────────────────┘              ▼                  ▼
                                                     MongoDB          IPFS (Pinata/Kubo)
```

## Sources of truth

| Data | Authoritative source | Cached in |
|---|---|---|
| Roles, verification, admin | `RoleManager` | `users` (index) |
| Public profile (name, org, location) | `UserRegistry` | `users` |
| Batch identity, owner, status | `ProductRegistry` | `products` |
| Journey history, pending transfers | `SupplyChainTracker` | `chainevents` |
| Orders & payments | `PaymentEscrow` | `transactions` |
| Email / phone / profile photo CID | MongoDB (private, off-chain) | — |
| Photos, certificates, metadata JSON, inspection reports | IPFS (CID anchored on-chain) | — |

UI rules:
- Everything ownership- or permission-related is read on-chain. Dashboards call `getParticipantBatches` / `getFarmerBatches`, and the trace page calls `getBatchHistory` through a public RPC.
- Index-backed views (search, transaction list, stats, recent activity) carry an **“Indexed (cache)”** badge, and the transaction list has a per-row **Verify** button that re-checks the receipt on-chain.
- IPFS content carries an **“Off-chain document”** badge with an explanation of what a CID does and does not prove.

## Key flows

### Wallet authentication
1. `eth_requestAccounts` → account; `eth_chainId` → wrong-network banner + `wallet_switchEthereumChain` / `wallet_addEthereumChain`.
2. `useParticipant` reads `UserRegistry.getUser` and `RoleManager.isAdmin` → redirect to `/register`, `/dashboard/<role>` or `/admin`.
3. API sessions (needed only for uploads and private profile data): `GET /auth/nonce` → `personal_sign` (no gas) → `POST /auth/verify` → JWT. Nonces are single-use and expire after 10 minutes.

### Batch registration
`registerBatchFlow` (frontend/src/services/batchRegistration.ts):
1. Upload photo and certificate → CIDs.
2. Read `nextBatchId`, build metadata embedding `FC-<id>` and the CIDs, upload → `metadataCID`.
3. `registerBatch(expectedId, input)`. The contract reverts with `BatchIdMismatch` if another farmer took that ID, and the flow rebuilds the metadata once.
4. Wait for the receipt, parse `BatchRegistered` → batch ID → QR code. Success is never shown before confirmation.

### Custody transfer
`initiateTransfer` (owner, role rule checked) → pending → `acceptTransfer` by the recipient (re-checks both parties' verification) → `ProductRegistry.setOwner`. `rejectTransfer` and `cancelTransfer` leave ownership unchanged. Every step appends to the immutable history and emits `HistoryRecorded(batchId, index, …)`, which the UI uses to map history entries to tx hashes.

### Event indexing
`EventIndexer.syncOnce()` (backend/src/indexer/eventIndexer.ts):
1. Load the checkpoint `{lastBlock, lastBlockHash, fingerprint}`. If the contract set changed, or `lastBlock`'s hash no longer matches the chain (reset or deep reorg), wipe derived collections and re-index from the deployment block. Private profile data is kept.
2. `eth_getLogs` over `[lastBlock+1, head − confirmations]` in `INDEXER_BLOCK_RANGE` chunks.
3. For each tx: fetch the receipt, require `status == 1`, and require every log to be present in the receipt.
4. Upsert raw events keyed on unique `(txHash, logIndex)` (dedupe), upsert one `transactions` row per hash, then refresh `products` and `users` by reading current contract state, never by trusting event payloads alone.
5. Save the checkpoint after every chunk.

Polling via `eth_getLogs` (not WebSockets) means missed events are recovered on the next tick or after a restart. `GET /api/transactions/:hash` verifies and indexes unknown hashes on demand.

## Frontend structure

```
src/
  blockchain/   config (chain, addresses, ABIs), contracts, reads, enums, errors (custom-error decoding)
  context/      WalletContext
  hooks/        useParticipant, useTransaction, useBatches, useIpfs
  services/     api (REST + wallet session), batchRegistration (testable workflow)
  components/   ui/ (shadcn-style), BatchActions (role/stage rules mirror the contracts), BatchTimeline,
                BatchTable, QRCodeCard, charts, WalletButton, RequireRole, common
  layouts/      PublicLayout, DashboardLayout (role-aware sidebar, network gate)
  pages/        Landing, Connect, Register, FarmerDashboard, RegisterBatch, Batches, BatchDetails,
                ParticipantDashboards (Distributor/Warehouse/Retailer), Trace, Scan, Transactions,
                Payments, Admin
```
