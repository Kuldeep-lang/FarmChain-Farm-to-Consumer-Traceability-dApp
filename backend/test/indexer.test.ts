import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Interface, Wallet, id as keccakId, type InterfaceAbi } from "ethers";
import { ChainEvent, Product, SyncState, Transaction, User } from "../src/models/index.js";
import { EventIndexer, type LogSource, type RawLog, type RawReceipt } from "../src/indexer/eventIndexer.js";
import { abis } from "../src/config/contracts.js";
import { clearDb, onChainUser, startDb, stopDb, StubReader } from "./helpers.js";

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

const ADDR = {
  RoleManager: Wallet.createRandom().address,
  UserRegistry: Wallet.createRandom().address,
  ProductRegistry: Wallet.createRandom().address,
  SupplyChainTracker: Wallet.createRandom().address,
  PaymentEscrow: Wallet.createRandom().address,
  FarmChainTestToken: Wallet.createRandom().address,
};
const farmer = Wallet.createRandom().address;
const distributor = Wallet.createRandom().address;

/** In-memory chain: blocks, logs and receipts built from the real contract ABIs. */
class FakeChain implements LogSource {
  blocks: { number: number; hash: string; timestamp: number }[] = [{ number: 0, hash: keccakId("b0"), timestamp: 1_700_000_000 }];
  logs: RawLog[] = [];
  receipts = new Map<string, RawReceipt>();
  calls = { getLogs: 0 };
  private ifaces: Record<string, Interface> = Object.fromEntries(Object.entries(abis).map(([k, a]) => [k, new Interface(a as InterfaceAbi)]));

  /** Mines one block containing a single tx that emits the given events. */
  mine(events: { contract: keyof typeof ADDR; event: string; args: unknown[] }[], opts: { status?: number; from?: string } = {}) {
    const number = this.blocks.length;
    const hash = keccakId(`block-${number}-${Math.random()}`);
    this.blocks.push({ number, hash, timestamp: 1_700_000_000 + number * 12 });
    const txHash = keccakId(`tx-${number}-${Math.random()}`);
    const logs: RawLog[] = events.map((e, i) => {
      const iface = this.ifaces[e.contract];
      const { data, topics } = iface.encodeEventLog(iface.getEvent(e.event)!, e.args);
      return { address: ADDR[e.contract], topics, data, blockNumber: number, blockHash: hash, transactionHash: txHash, index: i };
    });
    this.logs.push(...logs);
    this.receipts.set(txHash, { status: opts.status ?? 1, from: opts.from ?? farmer, to: ADDR[events[0].contract], blockNumber: number, blockHash: hash, logs });
    return txHash;
  }

  async getBlockNumber() {
    return this.blocks.length - 1;
  }
  async getLogs(f: { address: string[]; fromBlock: number; toBlock: number }) {
    this.calls.getLogs++;
    const set = new Set(f.address.map((a) => a.toLowerCase()));
    return this.logs.filter((l) => l.blockNumber >= f.fromBlock && l.blockNumber <= f.toBlock && set.has(l.address.toLowerCase()));
  }
  async getTransactionReceipt(h: string) {
    return [...this.receipts.entries()].find(([k]) => k.toLowerCase() === h.toLowerCase())?.[1] ?? null;
  }
  async getBlock(n: number) {
    return this.blocks[n] ?? null;
  }
}

function makeIndexer(chain: FakeChain, reader: StubReader, blockRange = 2) {
  return new EventIndexer({
    source: chain,
    reader,
    addresses: ADDR,
    abis: abis as Record<string, InterfaceAbi>,
    chainId: 31337,
    startBlock: 1,
    confirmations: 0,
    blockRange,
  });
}

function seedJourney(chain: FakeChain, reader: StubReader) {
  reader.users.set(farmer.toLowerCase(), onChainUser(farmer, { verificationStatus: "Verified", roleActive: true }));
  reader.batches.set(10001, {
    batchId: 10001, farmer: farmer.toLowerCase(), productName: "Organic Tomatoes", category: "Vegetables", quantity: 500, unit: "kg",
    harvestDate: new Date(), farmLocation: "Coimbatore", metadataCID: "bafy", createdAt: new Date(), currentOwner: distributor.toLowerCase(),
    status: "REGISTERED", pendingTransferTo: null,
  });
  const reg = chain.mine([{ contract: "UserRegistry", event: "UserRegistered", args: [farmer, 1, "Ravi", 1] }]);
  chain.mine([{ contract: "RoleManager", event: "ParticipantVerified", args: [farmer, keccakId("FARMER_ROLE"), Wallet.createRandom().address, 2] }]);
  const batchTx = chain.mine([
    { contract: "ProductRegistry", event: "BatchRegistered", args: [10001, farmer, "Organic Tomatoes", "Vegetables", 500, "kg", "bafy", 3] },
    { contract: "SupplyChainTracker", event: "HistoryRecorded", args: [10001, 0, farmer, 0, 0, "0x0000000000000000000000000000000000000000", farmer, "Coimbatore", "bafy", 3] },
    { contract: "SupplyChainTracker", event: "HistoryRecorded", args: [10001, 1, farmer, 1, 1, "0x0000000000000000000000000000000000000000", farmer, "Coimbatore", "bafy", 3] },
  ]);
  const transferTx = chain.mine([
    { contract: "SupplyChainTracker", event: "TransferInitiated", args: [10001, farmer, distributor, "Farm gate", "", 4] },
    { contract: "SupplyChainTracker", event: "HistoryRecorded", args: [10001, 2, farmer, 2, 1, farmer, distributor, "Farm gate", "", 4] },
  ]);
  const shipTx = chain.mine(
    [{ contract: "SupplyChainTracker", event: "HistoryRecorded", args: [10001, 3, distributor, 6, 2, distributor, distributor, "NH544", "", 5] }],
    { from: distributor },
  );
  return { reg, batchTx, transferTx, shipTx };
}

describe("EventIndexer", () => {
  it("indexes events, transactions and refreshes projections from chain state", async () => {
    const chain = new FakeChain();
    const reader = new StubReader();
    const { batchTx, transferTx, shipTx } = seedJourney(chain, reader);
    const indexer = makeIndexer(chain, reader);

    const r = await indexer.syncOnce();
    expect(r.newEvents).toBe(8);
    expect(r.toBlock).toBe(5);
    expect(chain.calls.getLogs).toBe(3); // blocks 1-2, 3-4, 5 (range = 2): chunked log queries

    expect(await ChainEvent.countDocuments()).toBe(8);
    const tx = await Transaction.findOne({ hash: batchTx.toLowerCase() }).lean<{ operation: string; batchId: number; events: string[] }>();
    expect(tx!.operation).toBe("BatchRegistered");
    expect(tx!.batchId).toBe(10001);
    expect(tx!.events).toEqual(["BatchRegistered", "HistoryRecorded"]);
    const tTx = await Transaction.findOne({ hash: transferTx.toLowerCase() }).lean<{ operation: string; counterparty: string }>();
    expect(tTx!.operation).toBe("TransferInitiated");
    expect(tTx!.counterparty).toBe(distributor.toLowerCase());
    const sTx = await Transaction.findOne({ hash: shipTx.toLowerCase() }).lean<{ operation: string; from: string }>();
    expect(sTx!.operation).toBe("ShipmentRecorded"); // derived from HistoryRecorded.action
    expect(sTx!.from).toBe(distributor.toLowerCase());

    const product = await Product.findOne({ batchId: 10001 }).lean<{ productName: string; currentOwner: string; participants: string[]; registrationTx: string }>();
    expect(product!.productName).toBe("Organic Tomatoes");
    expect(product!.currentOwner).toBe(distributor.toLowerCase());
    expect(product!.participants).toEqual(expect.arrayContaining([farmer.toLowerCase(), distributor.toLowerCase()]));
    expect(product!.registrationTx).toBe(batchTx.toLowerCase());

    const user = await User.findOne({ wallet: farmer.toLowerCase() }).lean<{ verificationStatus: string; registeredOnChain: boolean }>();
    expect(user!.verificationStatus).toBe("Verified");
    expect(user!.registeredOnChain).toBe(true);

    const state = await SyncState.findOne({ key: "indexer" }).lean<{ lastBlock: number }>();
    expect(state!.lastBlock).toBe(5);
  });

  it("prevents duplicate indexing (same logs processed twice / re-sync)", async () => {
    const chain = new FakeChain();
    const reader = new StubReader();
    seedJourney(chain, reader);
    const indexer = makeIndexer(chain, reader);
    await indexer.syncOnce();
    expect(await indexer.processLogs(chain.logs)).toBe(0);
    await SyncState.updateOne({ key: "indexer" }, { $set: { lastBlock: 0, lastBlockHash: null } });
    const again = await indexer.syncOnce();
    expect(again.newEvents).toBe(0);
    expect(await ChainEvent.countDocuments()).toBe(8);
    expect(await Transaction.countDocuments()).toBe(5);
  });

  it("recovers missed events incrementally from the last indexed block", async () => {
    const chain = new FakeChain();
    const reader = new StubReader();
    seedJourney(chain, reader);
    const indexer = makeIndexer(chain, reader);
    await indexer.syncOnce();
    // events happen while the backend is "offline"
    chain.mine([{ contract: "SupplyChainTracker", event: "TransferAccepted", args: [10001, farmer, distributor, 9] }]);
    chain.mine([{ contract: "PaymentEscrow", event: "PaymentReleased", args: [1, 10001, farmer, 1000, 10] }]);
    const r = await indexer.syncOnce();
    expect(r.fromBlock).toBe(6);
    expect(r.newEvents).toBe(2);
    expect(await Transaction.countDocuments({ operation: "PaymentReleased" })).toBe(1);
  });

  it("skips logs whose receipt failed or does not contain them", async () => {
    const chain = new FakeChain();
    const reader = new StubReader();
    chain.mine([{ contract: "UserRegistry", event: "UserRegistered", args: [farmer, 1, "Ravi", 1] }], { status: 0 });
    const forgedTx = chain.mine([{ contract: "UserRegistry", event: "UserRegistered", args: [distributor, 2, "Fake", 1] }]);
    chain.receipts.get(forgedTx)!.logs = []; // log not present in receipt
    const indexer = makeIndexer(chain, reader);
    const r = await indexer.syncOnce();
    expect(r.newEvents).toBe(0);
    expect(await ChainEvent.countDocuments()).toBe(0);
  });

  it("ignores logs from unknown contracts", async () => {
    const chain = new FakeChain();
    const indexer = makeIndexer(chain, new StubReader());
    const n = await indexer.processLogs([{ address: Wallet.createRandom().address, topics: [keccakId("X()")], data: "0x", blockNumber: 1, blockHash: "0x1", transactionHash: keccakId("t"), index: 0 }]);
    expect(n).toBe(0);
  });

  it("rebuilds the index when the chain is reset (block hash mismatch)", async () => {
    const chain = new FakeChain();
    const reader = new StubReader();
    seedJourney(chain, reader);
    const indexer = makeIndexer(chain, reader);
    await indexer.syncOnce();
    await User.updateOne({ wallet: farmer.toLowerCase() }, { $set: { email: "keep@me.io" } });

    // Simulate restarting the Hardhat node: a brand-new chain with a different history.
    const fresh = new FakeChain();
    fresh.mine([{ contract: "UserRegistry", event: "UserRegistered", args: [distributor, 2, "New", 1] }]);
    reader.users.set(distributor.toLowerCase(), onChainUser(distributor, { role: "Distributor" }));
    const indexer2 = makeIndexer(fresh, reader);
    const r = await indexer2.syncOnce();
    expect(r.reset).toBe(true);
    expect(await ChainEvent.countDocuments()).toBe(1);
    expect(await Product.countDocuments()).toBe(0);
    const old = await User.findOne({ wallet: farmer.toLowerCase() }).lean<{ registeredOnChain: boolean; email: string }>();
    expect(old!.registeredOnChain).toBe(false); // derived data cleared
    expect(old!.email).toBe("keep@me.io"); // private off-chain data kept
  });

  it("verifies arbitrary transaction hashes before indexing them", async () => {
    const chain = new FakeChain();
    const reader = new StubReader();
    const indexer = makeIndexer(chain, reader);
    const ok = chain.mine([{ contract: "SupplyChainTracker", event: "TransferRejected", args: [10001, farmer, distributor, "No truck", 1] }]);
    const failed = chain.mine([{ contract: "ProductRegistry", event: "BatchRegistered", args: [10002, farmer, "X", "Y", 1, "kg", "", 1] }], { status: 0 });
    expect(await indexer.indexTransaction(ok)).toBe("indexed");
    expect(await indexer.indexTransaction(ok)).toBe("indexed");
    expect(await ChainEvent.countDocuments({ txHash: ok.toLowerCase() })).toBe(1);
    expect(await indexer.indexTransaction(failed)).toBe("failed");
    expect((await Transaction.findOne({ hash: failed.toLowerCase() }).lean<{ status: string }>())!.status).toBe("failed");
    expect(await indexer.indexTransaction(keccakId("missing"))).toBe("not_found");
    chain.receipts.set(keccakId("other"), { status: 1, from: farmer, to: Wallet.createRandom().address, blockNumber: 1, blockHash: "0x", logs: [] });
    expect(await indexer.indexTransaction(keccakId("other"))).toBe("unrelated");
  });
});
