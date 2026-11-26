# Deployment guide

## A. Local development (Hardhat)

```bash
npm run install:all
npm run chain                 # terminal A – keep running
npm run deploy:local          # writes blockchain/deployments/localhost.json and exports
                              # ABIs + addresses to frontend/src/abi and backend/src/abi
npm run seed:local            # optional demo data (labelled "(Demo)")
npm run mongo:dev             # terminal B – or docker compose up -d mongo
cp backend/.env.example backend/.env    # set JWT_SECRET
npm run backend               # terminal C
cp frontend/.env.example frontend/.env.local
npm run frontend              # terminal D → http://localhost:5173
```

Notes:
- Hardhat's first deployment always produces the same addresses, so the committed `deployments.json` works after a fresh `npm run chain` + `npm run deploy:local`.
- Restarting the chain wipes state. Redeploy (and reseed), then in MetaMask *Settings → Advanced → Clear activity tab data*. The backend indexer detects the reset by block hash and rebuilds automatically (`npm --prefix backend run reindex` forces it).
- Alternative deployment with Hardhat Ignition: `npx hardhat ignition deploy ignition/modules/FarmChain.ts --network localhost` (this does **not** export ABIs; run `npm --prefix blockchain run export-abi` and set addresses via env).

## B. Sepolia testnet

> Use a **dedicated development wallet** funded only with Sepolia test ETH (from a faucet). Never use a wallet holding real funds. Never put the private key in the frontend.

### 1. Configure

`blockchain/.env`:
```
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/<key>     # or Alchemy / QuickNode
PRIVATE_KEY=<dev wallet private key>
ETHERSCAN_API_KEY=<key>
ADDITIONAL_ADMINS=0xYourAdminMetaMaskAddress            # optional
```

### 2. Compile, test, deploy

```bash
npm run compile
npm run test:contracts
npm run deploy:sepolia
npm --prefix blockchain run verify:sepolia      # optional, verifies source on Etherscan
```

`deploy:sepolia` saves `blockchain/deployments/sepolia.json` (addresses + start block) and merges chain `11155111` into `frontend/src/abi/deployments.json` and `backend/src/abi/deployments.json`. It also prints the equivalent `CONTRACT_ADDRESS_*` values.

### 3. Backend

`backend/.env`:
```
RPC_URL=https://sepolia.infura.io/v3/<key>
CHAIN_ID=11155111
INDEXER_CONFIRMATIONS=3
INDEXER_BLOCK_RANGE=500          # lower it if your RPC limits eth_getLogs ranges
INDEXER_POLL_INTERVAL_MS=12000
MONGODB_URI=<Atlas or server URI>
JWT_SECRET=<long random string>
IPFS_PROVIDER=pinata
PINATA_JWT=<jwt>
CORS_ORIGIN=https://your-frontend.example
```
Build and run: `npm --prefix backend run build && npm --prefix backend start`. The indexer starts from the deployment block and backfills automatically.

### 4. Frontend

`frontend/.env.local` (or your hosting provider's env settings):
```
VITE_CHAIN_ID=11155111
VITE_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com   # public read-only RPC for consumers
VITE_API_URL=https://your-api.example/api
VITE_PUBLIC_APP_URL=https://your-frontend.example        # encoded into QR codes
VITE_IPFS_GATEWAY=https://<name>.mypinata.cloud/ipfs
```
Build: `npm --prefix frontend run build` → deploy `frontend/dist` to any static host (Vercel, Netlify, S3/CloudFront). Configure SPA fallback so `/trace/*` serves `index.html`.

### 5. MetaMask

Select **Sepolia** (built in). The app prompts users on the wrong network. Transaction hashes on the trace and transaction pages link to `https://sepolia.etherscan.io/tx/<hash>`.

### 6. Go-live checklist

- [ ] Contract tests pass; deployment addresses saved and committed (`deployments/sepolia.json`)
- [ ] Contracts verified on Etherscan
- [ ] Admin wallet verified participants via the Admin console
- [ ] `/api/health` shows `blockchain.connected`, `ipfs.configured`, indexer `lastError: null`
- [ ] A test batch traced from a phone by scanning its QR code
- [ ] `.env` files not committed; RPC/Pinata keys restricted to your domains where the provider supports it
