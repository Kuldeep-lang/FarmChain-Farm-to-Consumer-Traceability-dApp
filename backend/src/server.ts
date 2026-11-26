import { env } from "./config/env.js";
import { connectDatabase, disconnectDatabase } from "./config/db.js";
import { abis, addresses, contractsConfigured, deploymentStartBlock } from "./config/contracts.js";
import { createApp } from "./app.js";
import { createChainReader, getProvider } from "./services/chain.js";
import { createIpfsProvider } from "./services/ipfs.js";
import { EventIndexer, type LogSource } from "./indexer/eventIndexer.js";
import { logger } from "./utils/logger.js";

async function main() {
  await connectDatabase(env.MONGODB_URI);

  const provider = getProvider();
  const reader = createChainReader(provider);
  const ipfs = createIpfsProvider(env);
  if (!ipfs.configured) logger.warn("IPFS is NOT configured – uploads will return 503. Set PINATA_JWT (or IPFS_PROVIDER=kubo).");
  if (!contractsConfigured) logger.warn("Contract addresses/ABIs missing – run the blockchain deploy script. Chain features disabled.");

  let indexer: EventIndexer | null = null;
  if (contractsConfigured) {
    indexer = new EventIndexer({
      source: provider as unknown as LogSource,
      reader,
      addresses: addresses as Record<string, string>,
      abis: abis as Record<string, never>,
      chainId: env.CHAIN_ID,
      startBlock: deploymentStartBlock,
      confirmations: env.INDEXER_CONFIRMATIONS,
      blockRange: env.INDEXER_BLOCK_RANGE,
    });
    if (env.INDEXER_ENABLED) {
      indexer.start(env.INDEXER_POLL_INTERVAL_MS);
      logger.info(`Event indexer polling every ${env.INDEXER_POLL_INTERVAL_MS}ms from block ${deploymentStartBlock}`);
    }
  }

  const app = createApp(
    {
      ipfs,
      reader,
      indexer,
      auth: { jwtSecret: env.JWT_SECRET, jwtExpiresIn: env.JWT_EXPIRES_IN, chainId: env.CHAIN_ID },
      chainInfo: async () => ({ chainId: env.CHAIN_ID, blockNumber: await provider.getBlockNumber() }),
      contracts: addresses,
      maxUploadMb: env.MAX_UPLOAD_MB,
    },
    { corsOrigin: env.CORS_ORIGIN, logRequests: env.NODE_ENV === "development" },
  );

  const server = app.listen(env.PORT, () => {
    logger.info(`FarmChain API listening on http://localhost:${env.PORT}/api (chain ${env.CHAIN_ID} via ${env.RPC_URL})`);
  });

  const shutdown = async () => {
    logger.info("Shutting down…");
    indexer?.stop();
    server.close();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("Fatal startup error:", err);
  process.exit(1);
});
