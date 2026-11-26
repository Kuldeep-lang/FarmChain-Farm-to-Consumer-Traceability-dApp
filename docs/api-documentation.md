# FarmChain REST API

Base URL: `http://localhost:5000/api`. All responses are JSON. Errors look like `{ "error": "message", "details"?: [...] }`.

The API is a **non-authoritative index** over the blockchain plus private off-chain profile storage and an IPFS upload proxy. Responses from the index include `"source": "index"`.

**Rate limits** (per IP, 15 min): 600 general, 60 for `/auth/*`, 60 for uploads.
**Pagination**: `page` (≥1, default 1) and `limit` (1–100, default 20). Paginated responses return `{ items, page, limit, total, totalPages }`.

## Authentication (wallet signature → JWT)

Backend sessions never replace on-chain authorization. They only gate uploads and private data.

### `GET /auth/nonce?wallet=0x…`
Returns `{ nonce, message }`. Sign `message` with `personal_sign` (no gas). Valid for 10 minutes, single use.

### `POST /auth/verify`
```json
{ "wallet": "0x…", "message": "<exact message>", "signature": "0x…(65 bytes)" }
```
→ `{ "token": "<jwt>", "wallet": "0x…", "expiresIn": "12h" }`. Send it as `Authorization: Bearer <jwt>`.
Errors: 400 malformed input, 401 wrong signer / reused or expired nonce / tampered message.

### `GET /auth/me` (auth)
→ `{ wallet, isAdmin }` (`isAdmin` read on-chain).

## Health & stats

### `GET /health`
`{ status, database, blockchain: { connected, chainId, blockNumber }, contracts, ipfs: { provider, configured }, indexer: { running, lastIndexedBlock, lastSyncAt, lastError } }`. Returns 503 if MongoDB is down.

### `GET /stats`
Index counts: `participants, verifiedParticipants, pendingVerifications, verifiedFarmers, distributors, batches, transactions, batchesByStatus, batchesByCategory`.

## Users

### `POST /users/register` (auth)
Stores **private** off-chain profile data for a wallet that is **already registered on-chain**.
```json
{ "email": "ravi@example.com", "phone": "+91 98765 43210", "photoCID": "bafy…", "txHash": "0x…" }
```
Name, organization, location, role and verification are copied from the contracts. Client-supplied values are ignored. 400 if the wallet isn't registered on-chain.

### `GET /users?role=&status=&q=&page=&limit=`
Public directory of on-chain-registered users. `role`: `Farmer|Distributor|Warehouse|Retailer`; `status`: `Pending|Verified|Rejected|Revoked`. Email and phone are never included.

### `GET /users/:wallet`
Public profile. Email and phone are included only for the wallet itself or an on-chain admin (send a Bearer token).

## Admin (auth + on-chain `DEFAULT_ADMIN_ROLE`)

- `GET /admin/pending-verifications` — pending registrations, including contact details.
- `GET /admin/participants?role=&status=` — all participants, including contact details.

403 if the wallet is not an admin in `RoleManager`.

## IPFS

### `GET /ipfs/status`
`{ provider: "pinata"|"kubo"|"none", configured, maxUploadMb, allowed }`

### `POST /ipfs/upload` (auth, multipart)
Field `file`: JPG, PNG, WebP or PDF, ≤ `MAX_UPLOAD_MB` (default 10). The MIME type **and** magic bytes must match.
→ `201 { cid, url, size, mimeType, name }`. Errors: 400 type or content mismatch, 413 too large, 503 IPFS not configured.

### `POST /ipfs/upload-json` (auth)
```json
{ "name": "FC-10001-metadata", "data": { "batchId": "FC-10001", "productName": "Organic Tomatoes" } }
```
→ `201 { cid, url, size }`. `data` must be an object of at most 100 KB.

## Products (batches)

### `GET /products?status=&farmer=&owner=&participant=&category=&page=&limit=`
Indexed batches, newest first. `status` is a stage name (e.g. `IN_TRANSIT`).

### `GET /products/search?q=`
Case-insensitive match on product name, category and location; `FC-10001` or `10001` matches the ID. Regex input is escaped.

### `GET /products/:batchId`
`:batchId` = `10001` or `FC-10001`. → `{ product (index), onChain (live contract read), chainError }`. 404 if the batch is in neither.

### `GET /products/:batchId/events`
Raw indexed events for the batch (ordered by block and log index).

## Transactions

### `GET /transactions?type=&batchId=&wallet=&from=&to=&page=&limit=`
One row per transaction: `{ hash, blockNumber, from, to, contract, operation, events[], batchId, orderId, counterparty, participants[], status, timestamp }`. `type` filters on `operation` (e.g. `BatchRegistered`, `TransferAccepted`, `ShipmentRecorded`, `PaymentReleased`). `from` and `to` are ISO dates.

### `GET /transactions/:hash`
If the hash isn't indexed yet, the server fetches the receipt, verifies it targets FarmChain contracts, and indexes it (successful) or records it as failed. 404 for unknown or unrelated hashes. → `{ transaction, events }`.

## Postman quick test

1. `GET {{base}}/health`
2. `GET {{base}}/products/search?q=tomato`
3. `GET {{base}}/transactions?batchId=FC-10001`
4. For authenticated calls, sign the nonce message in the browser console: `await ethereum.request({method:"personal_sign", params:[message, wallet]})`.
