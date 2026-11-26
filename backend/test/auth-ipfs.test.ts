import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { Wallet } from "ethers";
import { Upload } from "../src/models/index.js";
import { buildTestApp, clearDb, login, startDb, StubIpfs, stopDb } from "./helpers.js";

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const PDF = Buffer.from("%PDF-1.7\n%test document\n");
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]);

describe("wallet signature authentication", () => {
  it("issues a nonce and exchanges a valid signature for a session token", async () => {
    const { app } = buildTestApp();
    const wallet = Wallet.createRandom();
    const n = await request(app).get("/api/auth/nonce").query({ wallet: wallet.address });
    expect(n.status).toBe(200);
    expect(n.body.message).toContain(wallet.address);
    expect(n.body.message).toContain("will not trigger a blockchain transaction");
    const signature = await wallet.signMessage(n.body.message);
    const v = await request(app).post("/api/auth/verify").send({ wallet: wallet.address, message: n.body.message, signature });
    expect(v.status).toBe(200);
    expect(v.body.wallet).toBe(wallet.address.toLowerCase());
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${v.body.token}`);
    expect(me.body).toEqual({ wallet: wallet.address.toLowerCase(), isAdmin: false });
  });

  it("rejects signatures from a different wallet", async () => {
    const { app } = buildTestApp();
    const wallet = Wallet.createRandom();
    const attacker = Wallet.createRandom();
    const n = await request(app).get("/api/auth/nonce").query({ wallet: wallet.address });
    const signature = await attacker.signMessage(n.body.message);
    const v = await request(app).post("/api/auth/verify").send({ wallet: wallet.address, message: n.body.message, signature });
    expect(v.status).toBe(401);
  });

  it("nonces are single-use (replay protection)", async () => {
    const { app } = buildTestApp();
    const wallet = Wallet.createRandom();
    const n = await request(app).get("/api/auth/nonce").query({ wallet: wallet.address });
    const signature = await wallet.signMessage(n.body.message);
    const body = { wallet: wallet.address, message: n.body.message, signature };
    expect((await request(app).post("/api/auth/verify").send(body)).status).toBe(200);
    expect((await request(app).post("/api/auth/verify").send(body)).status).toBe(401);
  });

  it("rejects tampered messages and malformed input", async () => {
    const { app } = buildTestApp();
    const wallet = Wallet.createRandom();
    const n = await request(app).get("/api/auth/nonce").query({ wallet: wallet.address });
    const tampered = n.body.message.replace("Chain ID: 31337", "Chain ID: 1");
    const signature = await wallet.signMessage(tampered);
    expect((await request(app).post("/api/auth/verify").send({ wallet: wallet.address, message: tampered, signature })).status).toBe(401);
    expect((await request(app).post("/api/auth/verify").send({ wallet: wallet.address, message: "Hello there friend", signature })).status).toBe(400);
    expect((await request(app).post("/api/auth/verify").send({ wallet: wallet.address, message: n.body.message, signature: "0x12" })).status).toBe(400);
  });

  it("rejects expired/forged tokens", async () => {
    const { app } = buildTestApp();
    const forged = "eyJhbGciOiJIUzI1NiJ9.eyJ3YWxsZXQiOiIweDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAifQ.bad";
    expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${forged}`)).status).toBe(401);
    expect((await request(app).get("/api/auth/me")).status).toBe(401);
  });
});

describe("IPFS upload handling", () => {
  it("requires authentication", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/api/ipfs/upload").attach("file", PNG, { filename: "a.png", contentType: "image/png" });
    expect(res.status).toBe(401);
  });

  it("uploads valid PNG / JPEG / PDF files and returns the CID + gateway URL", async () => {
    const { app, ipfs } = buildTestApp();
    const { token, wallet } = await login(app);
    for (const [buf, name, type] of [[PNG, "farm photo.png", "image/png"], [JPEG, "tomatoes.jpg", "image/jpeg"], [PDF, "organic-cert.pdf", "application/pdf"]] as const) {
      const res = await request(app).post("/api/ipfs/upload").set("Authorization", `Bearer ${token}`).attach("file", buf, { filename: name, contentType: type });
      expect(res.status, name).toBe(201);
      expect(res.body.cid).toMatch(/^bafk/);
      expect(res.body.url).toBe(`https://gateway.example/ipfs/${res.body.cid}`);
      expect(res.body.mimeType).toBe(type);
    }
    expect((ipfs as StubIpfs).uploads).toHaveLength(3);
    expect((ipfs as StubIpfs).uploads[0].name).toBe("farm_photo.png"); // sanitised
    expect(await Upload.countDocuments({ wallet: wallet.address.toLowerCase() })).toBe(3);
  });

  it("rejects unsupported types and spoofed content", async () => {
    const { app } = buildTestApp();
    const { token } = await login(app);
    const txt = await request(app).post("/api/ipfs/upload").set("Authorization", `Bearer ${token}`).attach("file", Buffer.from("hello"), { filename: "a.txt", contentType: "text/plain" });
    expect(txt.status).toBe(400);
    const spoofed = await request(app).post("/api/ipfs/upload").set("Authorization", `Bearer ${token}`).attach("file", Buffer.from("MZ executable"), { filename: "evil.png", contentType: "image/png" });
    expect(spoofed.status).toBe(400);
    expect(spoofed.body.error).toMatch(/does not match/);
    const mismatch = await request(app).post("/api/ipfs/upload").set("Authorization", `Bearer ${token}`).attach("file", PDF, { filename: "x.png", contentType: "image/png" });
    expect(mismatch.status).toBe(400);
    const none = await request(app).post("/api/ipfs/upload").set("Authorization", `Bearer ${token}`);
    expect(none.status).toBe(400);
  });

  it("enforces the file size limit", async () => {
    const { app } = buildTestApp(); // maxUploadMb = 1
    const { token } = await login(app);
    const big = Buffer.concat([PNG, Buffer.alloc(1.5 * 1024 * 1024)]);
    const res = await request(app).post("/api/ipfs/upload").set("Authorization", `Bearer ${token}`).attach("file", big, { filename: "big.png", contentType: "image/png" });
    expect(res.status).toBe(413);
  });

  it("uploads metadata JSON", async () => {
    const { app } = buildTestApp();
    const { token } = await login(app);
    const res = await request(app)
      .post("/api/ipfs/upload-json")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "FC-10001-metadata", data: { batchId: "FC-10001", productName: "Organic Tomatoes" } });
    expect(res.status).toBe(201);
    expect(res.body.cid).toMatch(/^bafk/);
    const bad = await request(app).post("/api/ipfs/upload-json").set("Authorization", `Bearer ${token}`).send({ data: "not an object" });
    expect(bad.status).toBe(400);
  });

  it("returns 503 (not a fake success) when IPFS is not configured", async () => {
    const { app } = buildTestApp({ ipfs: new StubIpfs(false) });
    const { token } = await login(app);
    const res = await request(app).post("/api/ipfs/upload").set("Authorization", `Bearer ${token}`).attach("file", PNG, { filename: "a.png", contentType: "image/png" });
    expect(res.status).toBe(503);
    const j = await request(app).post("/api/ipfs/upload-json").set("Authorization", `Bearer ${token}`).send({ data: { a: 1 } });
    expect(j.status).toBe(503);
    const status = await request(app).get("/api/ipfs/status");
    expect(status.body.configured).toBe(false);
  });
});
