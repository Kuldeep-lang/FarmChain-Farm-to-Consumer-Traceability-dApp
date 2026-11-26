/** Forces a full rebuild of the MongoDB index from on-chain logs. */
import { env } from "../src/config/env.js";
import { connectDatabase, disconnectDatabase } from "../src/config/db.js";
import { abis, addresses, contractsConfigured, deploymentStartBlock } from "../src/config/contracts.js";
import { SyncState } from "../src/models/index.js";
import { createChainReader, getProvider } from "../src/services/chain.js";
import { EventIndexer, type LogSource } from "../src/indexer/eventIndexer.js";

if (!contractsConfigured) throw new Error("Contracts not configured");
await connectDatabase(env.MONGODB_URI);
await SyncState.deleteMany({});
const provider = getProvider();
const indexer = new EventIndexer({
  source: provider as unknown as LogSource,
  reader: createChainReader(provider),
  addresses: addresses as Record<string, string>,
  abis: abis as Record<string, never>,
  chainId: env.CHAIN_ID,
  startBlock: deploymentStartBlock,
  confirmations: env.INDEXER_CONFIRMATIONS,
  blockRange: env.INDEXER_BLOCK_RANGE,
});
const r = await indexer.syncOnce();
console.log(`Re-indexed blocks ${r.fromBlock}-${r.toBlock}: ${r.newEvents} events`);
await disconnectDatabase();
