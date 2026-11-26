/**
 * Starts a local MongoDB server for development WITHOUT installing MongoDB or Docker.
 * Uses mongodb-memory-server with a persistent data directory (backend/.mongo-data).
 * The first run downloads a MongoDB binary (~100 MB) into the user cache.
 *
 *   npm run mongo:dev     -> mongodb://127.0.0.1:27017/farmchain
 */
import { MongoMemoryServer } from "mongodb-memory-server";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dbPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".mongo-data");
mkdirSync(dbPath, { recursive: true });

const port = Number(process.env.MONGO_PORT ?? 27017);
const server = await MongoMemoryServer.create({
  instance: { port, ip: "127.0.0.1", dbPath, storageEngine: "wiredTiger" },
});
console.log(`Development MongoDB running at ${server.getUri()}farmchain`);
console.log(`Data directory: ${dbPath}  (Ctrl+C to stop)`);

const stop = async () => {
  await server.stop({ doCleanup: false });
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
