import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000, // first run downloads the MongoDB binary for mongodb-memory-server
    fileParallelism: false,
    env: { NODE_ENV: "test", JWT_SECRET: "test-secret-test-secret-test-secret", INDEXER_ENABLED: "false" },
  },
});
