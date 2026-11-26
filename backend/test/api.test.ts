import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { Wallet } from "ethers";
import { Product, Transaction, User } from "../src/models/index.js";
import { buildTestApp, clearDb, login, onChainUser, startDb, stopDb } from "./helpers.js";

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

describe("health & routing", () => {
  it("GET /api/health reports database, chain and ipfs status", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.database).toBe("connected");
    expect(res.body.blockchain).toMatchObject({ connected: true, chainId: 31337, blockNumber: 123 });
    expect(res.body.ipfs).toEqual({ provider: "pinata", configured: true });
  });

  it("reports blockchain as disconnected when the RPC fails", async () => {
    const { app } = buildTestApp({ chainInfo: async () => { throw new Error("down"); } });
    const res = await request(app).get("/api/health");
    expect(res.body.blockchain.connected).toBe(false);
  });

  it("returns 404 JSON for unknown routes and 400 for malformed JSON", async () => {
    const { app } = buildTestApp();
    expect((await request(app).get("/api/nope")).status).toBe(404);
    const bad = await request(app).post("/api/auth/verify").set("Content-Type", "application/json").send("{bad json");
    expect(bad.status).toBe(400);
  });

  it("sets security headers", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("request validation", () => {
  it("rejects invalid wallet, batch id, tx hash and pagination", async () => {
    const { app } = buildTestApp();
    const cases = [
      "/api/users/not-a-wallet",
      "/api/products/abc",
      "/api/transactions/0x1234",
      "/api/products?limit=1000",
      "/api/products?page=0",
      "/api/products?status=FLYING",
      "/api/products/search",
      "/api/transactions?batchId=xyz",
      "/api/auth/nonce?wallet=0x123",
    ];
    for (const url of cases) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(400);
      expect(res.body.error).toBeTruthy();
    }
  });

  it("validates the profile registration body", async () => {
    const { app, reader } = buildTestApp();
    const { token, wallet } = await login(app);
    reader.users.set(wallet.address.toLowerCase(), onChainUser(wallet.address));
    const res = await request(app).post("/api/users/register").set("Authorization", `Bearer ${token}`).send({ email: "nope", phone: "abc" });
    expect(res.status).toBe(400);
    expect(res.body.details.map((d: { path: string }) => d.path).sort()).toEqual(["email", "phone"]);
  });
});

describe("users", () => {
  it("stores off-chain profile only for wallets registered on-chain; role comes from chain", async () => {
    const { app, reader } = buildTestApp();
    const { token, wallet } = await login(app);
    const notYet = await request(app).post("/api/users/register").set("Authorization", `Bearer ${token}`).send({ email: "ravi@example.com" });
    expect(notYet.status).toBe(400);

    reader.users.set(wallet.address.toLowerCase(), onChainUser(wallet.address, { role: "Farmer" }));
    const ok = await request(app)
      .post("/api/users/register")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "ravi@example.com", phone: "+91 98765 43210", role: "Admin", verificationStatus: "Verified" });
    expect(ok.status).toBe(201);
    expect(ok.body.user.role).toBe("Farmer"); // client-supplied role ignored
    expect(ok.body.user.verificationStatus).toBe("Pending");
    expect(ok.body.user.email).toBe("ravi@example.com");
  });

  it("requires authentication to register a profile", async () => {
    const { app } = buildTestApp();
    expect((await request(app).post("/api/users/register").send({})).status).toBe(401);
    expect((await request(app).post("/api/users/register").set("Authorization", "Bearer garbage").send({})).status).toBe(401);
  });

  it("hides private contact details from the public but shows them to the owner and admins", async () => {
    const { app, reader } = buildTestApp();
    const owner = Wallet.createRandom();
    await User.create({ wallet: owner.address.toLowerCase(), name: "Ravi", role: "Farmer", registeredOnChain: true, email: "ravi@example.com", phone: "123456" });

    const pub = await request(app).get(`/api/users/${owner.address}`);
    expect(pub.status).toBe(200);
    expect(pub.body.user.name).toBe("Ravi");
    expect(pub.body.user.email).toBeUndefined();
    expect(pub.body.user.phone).toBeUndefined();

    const { token } = await login(app, owner);
    const self = await request(app).get(`/api/users/${owner.address}`).set("Authorization", `Bearer ${token}`);
    expect(self.body.user.email).toBe("ravi@example.com");

    const adminWallet = Wallet.createRandom();
    reader.admins.add(adminWallet.address.toLowerCase());
    const { token: adminToken } = await login(app, adminWallet);
    const asAdmin = await request(app).get(`/api/users/${owner.address}`).set("Authorization", `Bearer ${adminToken}`);
    expect(asAdmin.body.user.phone).toBe("123456");
  });

  it("lists users with filters and pagination, never exposing PII", async () => {
    const { app } = buildTestApp();
    for (let i = 0; i < 5; i++) {
      await User.create({ wallet: Wallet.createRandom().address.toLowerCase(), name: `U${i}`, role: i % 2 ? "Farmer" : "Retailer", registeredOnChain: true, email: "x@y.z", registeredAt: new Date(Date.now() - i * 1000) });
    }
    const res = await request(app).get("/api/users").query({ role: "Farmer", limit: 1 });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.totalPages).toBe(2);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].email).toBeUndefined();
  });
});

describe("admin endpoints are protected by the on-chain admin role", () => {
  it("rejects anonymous and non-admin wallets; allows admins", async () => {
    const { app, reader } = buildTestApp();
    await User.create({ wallet: Wallet.createRandom().address.toLowerCase(), name: "Pending One", registeredOnChain: true, verificationStatus: "Pending", email: "p@x.io" });
    expect((await request(app).get("/api/admin/pending-verifications")).status).toBe(401);

    const { token } = await login(app);
    expect((await request(app).get("/api/admin/pending-verifications").set("Authorization", `Bearer ${token}`)).status).toBe(403);

    const admin = Wallet.createRandom();
    reader.admins.add(admin.address.toLowerCase());
    const { token: t2 } = await login(app, admin);
    const ok = await request(app).get("/api/admin/pending-verifications").set("Authorization", `Bearer ${t2}`);
    expect(ok.status).toBe(200);
    expect(ok.body.items).toHaveLength(1);
    expect(ok.body.items[0].email).toBe("p@x.io");
    const all = await request(app).get("/api/admin/participants").set("Authorization", `Bearer ${t2}`);
    expect(all.body.total).toBe(1);
  });
});

describe("products & transactions (index)", () => {
  beforeEach(async () => {
    const farmer = "0x" + "a".repeat(40);
    await Product.create([
      { batchId: 10001, farmer, productName: "Organic Tomatoes", category: "Vegetables", quantity: 500, unit: "kg", farmLocation: "Coimbatore", status: "AVAILABLE_FOR_SALE", currentOwner: farmer, participants: [farmer] },
      { batchId: 10002, farmer, productName: "Ponni Rice", category: "Grains", quantity: 2, unit: "tonnes", farmLocation: "Thanjavur", status: "AT_WAREHOUSE", currentOwner: farmer, participants: [farmer] },
    ]);
    await Transaction.create([
      { hash: "0x" + "1".repeat(64), blockNumber: 5, from: farmer, operation: "BatchRegistered", batchId: 10001, participants: [farmer], timestamp: new Date("2026-11-01") },
      { hash: "0x" + "2".repeat(64), blockNumber: 6, from: farmer, operation: "TransferInitiated", batchId: 10002, participants: [farmer], timestamp: new Date("2026-11-10") },
    ]);
  });

  it("lists, filters and paginates products", async () => {
    const { app } = buildTestApp();
    const all = await request(app).get("/api/products");
    expect(all.body.total).toBe(2);
    expect(all.body.items[0].batchId).toBe(10002);
    expect(all.body.source).toBe("index");
    const f = await request(app).get("/api/products").query({ status: "AT_WAREHOUSE" });
    expect(f.body.items.map((p: { batchId: number }) => p.batchId)).toEqual([10002]);
  });

  it("searches products by name, location and batch id (regex-safe)", async () => {
    const { app } = buildTestApp();
    expect((await request(app).get("/api/products/search").query({ q: "tomato" })).body.total).toBe(1);
    expect((await request(app).get("/api/products/search").query({ q: "thanjavur" })).body.total).toBe(1);
    expect((await request(app).get("/api/products/search").query({ q: "FC-10002" })).body.items[0].productName).toBe("Ponni Rice");
    expect((await request(app).get("/api/products/search").query({ q: ".*(" })).status).toBe(200);
  });

  it("returns a product with a live on-chain read and 404 for unknown batches", async () => {
    const { app, reader } = buildTestApp();
    reader.batches.set(10001, { batchId: 10001, status: "SOLD" } as never);
    const res = await request(app).get("/api/products/FC-10001");
    expect(res.status).toBe(200);
    expect(res.body.product.productName).toBe("Organic Tomatoes");
    expect(res.body.onChain.status).toBe("SOLD");
    expect((await request(app).get("/api/products/99999")).status).toBe(404);
  });

  it("filters transactions by type, batch and date range", async () => {
    const { app } = buildTestApp();
    expect((await request(app).get("/api/transactions")).body.total).toBe(2);
    expect((await request(app).get("/api/transactions").query({ type: "BatchRegistered" })).body.total).toBe(1);
    expect((await request(app).get("/api/transactions").query({ batchId: "FC-10002" })).body.items[0].operation).toBe("TransferInitiated");
    expect((await request(app).get("/api/transactions").query({ from: "2026-11-05" })).body.total).toBe(1);
    expect((await request(app).get(`/api/transactions/0x${"1".repeat(64)}`)).body.transaction.operation).toBe("BatchRegistered");
    expect((await request(app).get(`/api/transactions/0x${"9".repeat(64)}`)).status).toBe(404);
  });

  it("exposes index statistics", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/stats");
    expect(res.body.batches).toBe(2);
    expect(res.body.transactions).toBe(2);
    expect(res.body.batchesByCategory).toEqual({ Vegetables: 1, Grains: 1 });
  });
});
