import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Wallet } from "ethers";
import request from "supertest";
import { createApp } from "../src/app.js";
import type { AppDeps } from "../src/controllers/index.js";
import type { ChainReader, OnChainBatch, OnChainUser } from "../src/services/chain.js";
import type { IpfsProvider } from "../src/services/ipfs.js";

let mongo: MongoMemoryServer | null = null;

export async function startDb() {
  // mongod start-up can be slow on a busy machine; retry once instead of failing the suite.
  for (let attempt = 1; ; attempt++) {
    try {
      mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
      await mongoose.connect(mongo.getUri(), { dbName: "farmchain-test" });
      return;
    } catch (err) {
      await mongo?.stop().catch(() => {});
      if (attempt >= 2) throw err;
    }
  }
}

export async function stopDb() {
  await mongoose.disconnect();
  await mongo?.stop();
}

export async function clearDb() {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

export class StubReader implements ChainReader {
  users = new Map<string, OnChainUser>();
  batches = new Map<number, OnChainBatch>();
  admins = new Set<string>();
  async getUser(w: string) {
    return this.users.get(w.toLowerCase()) ?? null;
  }
  async getBatch(id: number) {
    return this.batches.get(id) ?? null;
  }
  async isAdmin(w: string) {
    return this.admins.has(w.toLowerCase());
  }
  async isRegistered(w: string) {
    return this.users.has(w.toLowerCase());
  }
}

export class StubIpfs implements IpfsProvider {
  readonly name = "pinata" as const;
  uploads: { kind: string; name: string; size: number }[] = [];
  constructor(public configured = true) {}
  async uploadFile(data: Buffer, fileName: string) {
    this.uploads.push({ kind: "file", name: fileName, size: data.length });
    return { cid: "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy", size: data.length };
  }
  async uploadJson(data: object, name: string) {
    this.uploads.push({ kind: "json", name, size: JSON.stringify(data).length });
    return { cid: "bafkreidivzimqfqtoqxkrpge6bjyhlvxqs3rhe73owtmdulaxr5do5in7u", size: 42 };
  }
  gatewayUrl(cid: string) {
    return `https://gateway.example/ipfs/${cid}`;
  }
}

export const JWT_SECRET = "test-secret-test-secret-test-secret";

export function buildTestApp(overrides: Partial<AppDeps> = {}) {
  const reader = (overrides.reader as StubReader) ?? new StubReader();
  const ipfs = (overrides.ipfs as StubIpfs) ?? new StubIpfs();
  const deps: AppDeps = {
    ipfs,
    reader,
    indexer: null,
    auth: { jwtSecret: JWT_SECRET, jwtExpiresIn: "1h", chainId: 31337 },
    chainInfo: async () => ({ chainId: 31337, blockNumber: 123 }),
    contracts: {},
    maxUploadMb: 1,
    ...overrides,
  };
  return { app: createApp(deps, { corsOrigin: "http://localhost:5173" }), reader, ipfs, deps };
}

/** Full wallet sign-in flow; returns a bearer token. */
export async function login(app: Parameters<typeof request>[0], wallet = Wallet.createRandom()) {
  const n = await request(app).get("/api/auth/nonce").query({ wallet: wallet.address });
  const signature = await wallet.signMessage(n.body.message);
  const r = await request(app).post("/api/auth/verify").send({ wallet: wallet.address, message: n.body.message, signature });
  return { token: r.body.token as string, wallet };
}

export function onChainUser(wallet: string, over: Partial<OnChainUser> = {}): OnChainUser {
  return {
    wallet: wallet.toLowerCase(),
    name: "Ravi Kumar",
    organization: "Green Valley Farms",
    location: "Coimbatore",
    role: "Farmer",
    registeredAt: new Date(),
    updatedAt: new Date(),
    verificationStatus: "Pending",
    roleActive: false,
    ...over,
  };
}
