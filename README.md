# FarmChain

**From Farm to Fork. Verified on Blockchain.**

FarmChain is a decentralized agricultural supply-chain tracking platform. Farmers register harvest batches on-chain, custody moves through distributors, warehouses and retailers via two-step (offer → accept) transfers, payments run through an ERC-20 escrow, and consumers scan a QR code to see the verified journey — no wallet required.

| Layer | Stack |
|---|---|
| Smart contracts | Solidity 0.8.24, Hardhat 2, OpenZeppelin 5 (AccessControl, ReentrancyGuard, Pausable, SafeERC20) |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS + shadcn/ui, TanStack Query, ethers v6, React Hook Form + Zod, Recharts, qrcode, html5-qrcode |
| Backend | Node.js, Express 5, TypeScript, MongoDB/Mongoose, JWT (wallet-signature login), Multer, Pinata SDK, event indexer |
| Storage | IPFS via Pinata (or a local Kubo node) |

> The blockchain is the source of truth for identity, roles, ownership and history. MongoDB is only a search index/cache, and every page labels where its data comes from. FarmChain proves **who** recorded **what** and **when**; it does not by itself prove physical quality or origin.

---

## Repository layout

```
farmchain/
├── blockchain/   Solidity contracts, Hardhat tests, deploy/seed/verify scripts, Ignition module
├── backend/      Express API, MongoDB models, IPFS service, blockchain event indexer
├── frontend/     React DApp (13+ pages)
├── docs/         architecture, smart contracts, API, deployment guide
└── docker-compose.yml   optional MongoDB + IPFS (Kubo)
```

## Prerequisites

- Node.js 20.19+ (tested on Node 24) and npm 10+
- MetaMask browser extension
- MongoDB — **any one of**: `npm run mongo:dev` (embedded, no install), `docker compose up -d mongo`, a local MongoDB install, or MongoDB Atlas
- Optional: a [Pinata](https://app.pinata.cloud) API JWT (for photo/document uploads), or a local IPFS node

## Quick start (local Hardhat network)

Run each long-running command in its own terminal, from the repository root.

```bash
# 0. Install everything
npm run install:all

# 1. Terminal A – local blockchain (prints 20 funded test accounts)
npm run chain

# 2. Terminal B – deploy contracts (exports ABIs + addresses to frontend & backend), then seed demo data
npm run deploy:local
npm run seed:local          # optional: 4 demo participants + 5 sample batches

# 3. Terminal C – MongoDB (skip if you already run MongoDB)
npm run mongo:dev

# 4. Terminal D – backend API on http://localhost:5000/api
cp backend/.env.example backend/.env        # then set JWT_SECRET (and PINATA_JWT if you have one)
npm run backend

# 5. Terminal E – frontend on http://localhost:5173
cp frontend/.env.example frontend/.env.local   # defaults work for local Hardhat
npm run frontend
```

Open http://localhost:5173 and try `http://localhost:5173/trace/10001` (after seeding).

### MetaMask setup for local development

1. Add network: **Hardhat Local**, RPC `http://127.0.0.1:8545`, chain ID `31337`, symbol `ETH` (the app also offers a one-click "Switch network").
2. Import test accounts from the `npm run chain` output (these keys are public Hardhat test keys — never use them on a real network):

| # | Role in seed data | Address |
|---|---|---|
| 0 | Admin (deployer) | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| 1 | Farmer | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| 2 | Distributor | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` |
| 3 | Warehouse | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` |
| 4 | Retailer | `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` |
| 5+ | Unregistered – use to try registration | — |

3. **After restarting `npm run chain`**, redeploy, and in MetaMask use *Settings → Advanced → Clear activity tab data* (otherwise nonce errors). The backend indexer detects the chain reset and rebuilds its index automatically.

### IPFS configuration

Uploads go through the backend so secrets never reach the browser. In `backend/.env`:

- **Pinata**: `IPFS_PROVIDER=pinata`, `PINATA_JWT=<your JWT>`, optional `PINATA_GATEWAY=<name>.mypinata.cloud`
- **Local Kubo**: `docker compose up -d ipfs`, `IPFS_PROVIDER=kubo`, and in `frontend/.env.local` `VITE_IPFS_GATEWAY=http://127.0.0.1:8080/ipfs`

If neither is configured, upload endpoints return **503**, and the UI disables file inputs and says so. A batch can then be registered on-chain without off-chain metadata, but only after the farmer explicitly confirms it. Nothing pretends to upload.

## The demo scenario (spec §19)

1. Connect a fresh MetaMask account (#5+) → **Register** as Farmer (on-chain `registerUser`) → status *Pending verification*.
2. Connect account #0 → **Admin console** → *Approve* (on-chain `verifyParticipant`, grants `FARMER_ROLE`).
3. Farmer → **Register batch**: Organic Tomatoes, 500 kg, Coimbatore → files and metadata go to IPFS → `registerBatch` → after confirmation: batch ID, tx hash, QR code.
4. Optional escrow: distributor (#2) → **Payments** → create order for the batch → *Deposit* (approve + deposit).
5. Farmer → batch → **Transfer** to the distributor. Distributor → **Accept** → **Record shipment**. Farmer → Payments → **Release** (custody proven on-chain).
6. Distributor → **Transfer** to warehouse (#3) → warehouse **Accept** → **Confirm arrival** → **Quality inspection** → **Transfer** to retailer (#4).
7. Retailer → **Accept** → **Confirm receipt** → **Available for sale**.
8. Anyone (no wallet) → scan the QR or open `/trace/<batchId>` → full journey with tx hashes; on Sepolia every hash links to Etherscan.

This exact flow was run end-to-end in a real browser against the local stack (13 on-chain journey entries, all with verified transaction hashes).

## Testing

```bash
npm run test:contracts     # Hardhat + Chai  – 61 tests
npm run coverage           # solidity-coverage (100% statements on core contracts)
npm run test:backend       # Vitest + Supertest + in-memory MongoDB – 34 tests
npm run test:frontend      # Vitest + React Testing Library – 33 tests
npm test                   # all of the above
```

The first backend test run downloads a MongoDB binary (~100 MB) for `mongodb-memory-server`.

## Sepolia deployment (summary)

```bash
cp blockchain/.env.example blockchain/.env   # SEPOLIA_RPC_URL, PRIVATE_KEY (dev wallet only!), ETHERSCAN_API_KEY
npm run compile && npm run test:contracts
npm run deploy:sepolia                       # writes deployments/sepolia.json + exports ABIs/addresses
npm --prefix blockchain run verify:sepolia   # optional Etherscan source verification
```

Then set `CHAIN_ID=11155111`, `RPC_URL`, `INDEXER_CONFIRMATIONS=3` in `backend/.env`, and `VITE_CHAIN_ID=11155111`, `VITE_RPC_URL` in `frontend/.env.local`. Full details: [docs/deployment-guide.md](docs/deployment-guide.md).

## Environment variables

| File | Variables |
|---|---|
| `blockchain/.env` | `SEPOLIA_RPC_URL`, `PRIVATE_KEY`, `ETHERSCAN_API_KEY`, `ADDITIONAL_ADMINS` |
| `backend/.env` | `PORT`, `MONGODB_URI`, `JWT_SECRET`, `RPC_URL`, `CHAIN_ID`, `CONTRACT_ADDRESS_*`, `INDEXER_*`, `IPFS_PROVIDER`, `PINATA_JWT`, `PINATA_GATEWAY`, `KUBO_API_URL`, `IPFS_GATEWAY_URL`, `MAX_UPLOAD_MB`, `CORS_ORIGIN` |
| `frontend/.env.local` | `VITE_API_URL`, `VITE_CHAIN_ID`, `VITE_RPC_URL`, `VITE_PUBLIC_APP_URL`, `VITE_IPFS_GATEWAY`, `VITE_CONTRACT_ADDRESS_*` |

Contract addresses are optional everywhere: when blank, the apps read `src/abi/deployments.json`, which the deploy script writes. Each package has a commented `.env.example`. Real `.env` files are git-ignored.

## Security notes & limitations

- All write permissions are enforced on-chain by `RoleManager`; hidden buttons are never the security boundary. Participants cannot grant themselves roles, and participant roles cannot be granted through the generic `grantRole` path.
- Escrow has no admin withdrawal path; pausing never blocks releases or refunds.
- The backend never trusts client-supplied roles: admin endpoints check `RoleManager.isAdmin` on-chain, and profile registration copies role and status from the contracts.
- Uploads are validated by MIME type **and** magic bytes, size-limited, rate-limited, and require a wallet-signature session.
- Only non-confidential profile data (name, organization, location) is stored on-chain. Email and phone stay in MongoDB and are visible only to the owner and admins.
- **Limitations:** the harvest date, locations, inspection results and IPFS documents are *declared* by participants; the chain proves who declared them and when, not that they are true. The indexer stores what it saw and reads up to `head − INDEXER_CONFIRMATIONS`; set confirmations ≥ 3 on public networks. `fUSD` is a test token with a public faucet; never use it as real money. The admin key is a single EOA; use a multisig for anything beyond a demo.

More: [architecture](docs/architecture.md) · [smart contracts](docs/smart-contracts.md) · [API](docs/api-documentation.md) · [deployment](docs/deployment-guide.md)
