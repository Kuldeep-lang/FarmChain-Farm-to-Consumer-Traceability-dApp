import { Interface, ZeroAddress, type InterfaceAbi, type LogDescription } from "ethers";
import { ChainEvent, Product, SyncState, Transaction, User } from "../models/index.js";
import type { ChainReader } from "../services/chain.js";
import { ACTION_NAMES } from "../utils/chainEnums.js";
import { logger as defaultLogger } from "../utils/logger.js";

/** Minimal provider surface the indexer needs (an ethers Provider satisfies it). */
export interface LogSource {
  getBlockNumber(): Promise<number>;
  getLogs(filter: { address: string[]; fromBlock: number; toBlock: number }): Promise<readonly RawLog[]>;
  getTransactionReceipt(hash: string): Promise<RawReceipt | null>;
  getBlock(block: number): Promise<{ number: number; hash: string | null; timestamp: number } | null>;
}

export interface RawLog {
  address: string;
  topics: readonly string[];
  data: string;
  blockNumber: number;
  blockHash: string;
  transactionHash: string;
  index: number;
}

export interface RawReceipt {
  status: number | null;
  from: string;
  to: string | null;
  blockNumber: number;
  blockHash: string;
  logs: readonly RawLog[];
}

export interface IndexerOptions {
  source: LogSource;
  reader: ChainReader;
  addresses: Record<string, string>; // contract name -> address
  abis: Record<string, InterfaceAbi>;
  chainId: number;
  startBlock: number;
  confirmations: number;
  blockRange: number;
  logger?: typeof defaultLogger;
}

const STATE_KEY = "indexer";

/** Order used to pick the "operation" label for a transaction emitting several events. */
const OPERATION_PRIORITY = [
  "UserRegistered",
  "UserProfileUpdated",
  "ParticipantVerified",
  "ParticipantRejected",
  "VerificationRevoked",
  "ParticipantRoleGranted",
  "ParticipantRoleRevoked",
  "BatchRegistered",
  "BatchMetadataUpdated",
  "TransferInitiated",
  "TransferAccepted",
  "TransferRejected",
  "TransferCancelled",
  "QualityInspectionRecorded",
  "OrderCreated",
  "PaymentDeposited",
  "PaymentReleased",
  "PaymentRefunded",
  "OrderCancelled",
  "DeliveryConfirmed",
  "HistoryRecorded",
  "Approval",
  "Transfer",
];

const USER_EVENTS = new Set([
  "UserRegistered",
  "UserProfileUpdated",
  "ParticipantVerified",
  "ParticipantRejected",
  "VerificationRevoked",
  "ParticipantRoleGranted",
  "ParticipantRoleRevoked",
  "RoleGranted",
  "RoleRevoked",
]);

interface ParsedLog {
  raw: RawLog;
  contract: string;
  desc: LogDescription;
  args: Record<string, unknown>;
  addresses: string[];
  batchId?: number;
  orderId?: number;
}

export interface SyncResult {
  fromBlock: number;
  toBlock: number;
  newEvents: number;
  reset: boolean;
}

export class EventIndexer {
  private readonly ifaces = new Map<string, { name: string; iface: Interface }>();
  private readonly addressList: string[];
  private readonly fingerprint: string;
  private readonly log: typeof defaultLogger;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private syncing: Promise<SyncResult> | null = null;
  public lastError: string | null = null;
  public lastSyncAt: Date | null = null;

  constructor(private readonly opts: IndexerOptions) {
    for (const [name, address] of Object.entries(opts.addresses)) {
      if (!address || !opts.abis[name]) continue;
      this.ifaces.set(address.toLowerCase(), { name, iface: new Interface(opts.abis[name]) });
    }
    this.addressList = [...this.ifaces.keys()];
    this.fingerprint = `${opts.chainId}:${[...this.addressList].sort().join(",")}`;
    this.log = opts.logger ?? defaultLogger;
  }

  // ------------------------------------------------------------------ lifecycle

  start(intervalMs: number) {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      try {
        const r = await this.syncOnce();
        if (r.newEvents > 0) this.log.info(`indexer: +${r.newEvents} events (blocks ${r.fromBlock}-${r.toBlock})`);
        this.lastError = null;
      } catch (err) {
        this.lastError = (err as Error).message;
        this.log.warn(`indexer: sync failed – ${(err as Error).message}. Retrying.`);
      }
      if (this.running) this.timer = setTimeout(tick, intervalMs);
    };
    void tick();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Serialises concurrent sync calls (poll loop + on-demand verification). */
  syncOnce(): Promise<SyncResult> {
    if (!this.syncing) {
      this.syncing = this.doSync().finally(() => {
        this.syncing = null;
      });
    }
    return this.syncing;
  }

  async status() {
    const state = await SyncState.findOne({ key: STATE_KEY }).lean<{ lastBlock?: number }>();
    return {
      running: this.running,
      lastIndexedBlock: state?.lastBlock ?? null,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
    };
  }

  // ------------------------------------------------------------------ sync

  private async doSync(): Promise<SyncResult> {
    const { source, startBlock, confirmations, blockRange } = this.opts;
    let reset = false;
    let state = await SyncState.findOne({ key: STATE_KEY });

    if (!state || state.fingerprint !== this.fingerprint) {
      if (state) this.log.warn("indexer: contract set or chain changed – rebuilding index");
      await this.resetIndex();
      state = await this.saveState(startBlock - 1, null);
      reset = true;
    } else if (state.lastBlock !== undefined && state.lastBlock !== null && state.lastBlock >= startBlock && state.lastBlockHash) {
      // Detect chain resets (e.g. restarted Hardhat node) and deep reorgs.
      const block = await source.getBlock(state.lastBlock);
      if (!block || block.hash !== state.lastBlockHash) {
        this.log.warn(`indexer: block ${state.lastBlock} hash changed (chain reset/reorg) – rebuilding index`);
        await this.resetIndex();
        state = await this.saveState(startBlock - 1, null);
        reset = true;
      }
    }

    const head = (await source.getBlockNumber()) - confirmations;
    const from = (state.lastBlock ?? startBlock - 1) + 1;
    let newEvents = 0;
    if (head < from || this.addressList.length === 0) {
      this.lastSyncAt = new Date();
      return { fromBlock: from, toBlock: head, newEvents, reset };
    }

    for (let start = from; start <= head; start += blockRange) {
      const end = Math.min(start + blockRange - 1, head);
      const logs = await source.getLogs({ address: this.addressList, fromBlock: start, toBlock: end });
      newEvents += await this.processLogs(logs);
      const endBlock = await source.getBlock(end);
      await this.saveState(end, endBlock?.hash ?? null);
    }
    this.lastSyncAt = new Date();
    return { fromBlock: from, toBlock: head, newEvents, reset };
  }

  /**
   * Validate an arbitrary transaction hash against the chain and index it if it is a
   * successful FarmChain transaction. Returns false if it is unknown/unrelated.
   */
  async indexTransaction(hash: string): Promise<"indexed" | "failed" | "not_found" | "unrelated"> {
    const receipt = await this.opts.source.getTransactionReceipt(hash);
    if (!receipt) return "not_found";
    const ours = receipt.logs.filter((l) => this.ifaces.has(l.address.toLowerCase()));
    const toOurs = receipt.to ? this.ifaces.has(receipt.to.toLowerCase()) : false;
    if (!ours.length && !toOurs) return "unrelated";
    if (receipt.status !== 1) {
      const block = await this.opts.source.getBlock(receipt.blockNumber);
      await Transaction.updateOne(
        { hash: hash.toLowerCase() },
        {
          $setOnInsert: {
            hash: hash.toLowerCase(),
            blockNumber: receipt.blockNumber,
            from: receipt.from.toLowerCase(),
            to: receipt.to?.toLowerCase(),
            contract: receipt.to ? this.ifaces.get(receipt.to.toLowerCase())?.name : undefined,
            operation: "Failed",
            events: [],
            participants: [receipt.from.toLowerCase()],
            status: "failed",
            timestamp: block ? new Date(block.timestamp * 1000) : new Date(),
          },
        },
        { upsert: true },
      );
      return "failed";
    }
    await this.processLogs(ours, new Map([[hash.toLowerCase(), receipt]]));
    return "indexed";
  }

  // ------------------------------------------------------------------ processing

  /** Returns the number of newly inserted events (duplicates are ignored). */
  async processLogs(logs: readonly RawLog[], receiptCache = new Map<string, RawReceipt>()): Promise<number> {
    if (!logs.length) return 0;
    const byTx = new Map<string, RawLog[]>();
    for (const l of logs) {
      const key = l.transactionHash.toLowerCase();
      if (!byTx.has(key)) byTx.set(key, []);
      byTx.get(key)!.push(l);
    }

    const blockTimes = new Map<number, Date>();
    const blockTime = async (n: number) => {
      if (!blockTimes.has(n)) {
        const b = await this.opts.source.getBlock(n);
        blockTimes.set(n, b ? new Date(b.timestamp * 1000) : new Date());
      }
      return blockTimes.get(n)!;
    };

    let inserted = 0;
    const batchIds = new Set<number>();
    const users = new Set<string>();
    const batchParticipants = new Map<number, Set<string>>();
    const registrationTx = new Map<number, string>();
    const userRegistrationTx = new Map<string, string>();

    for (const [txHash, txLogs] of byTx) {
      // 1. Validate the transaction receipt before trusting the logs.
      let receipt = receiptCache.get(txHash) ?? null;
      if (!receipt) receipt = await this.opts.source.getTransactionReceipt(txHash);
      if (!receipt || receipt.status !== 1) {
        this.log.warn(`indexer: skipping ${txHash} – receipt missing or failed`);
        continue;
      }

      const parsed: ParsedLog[] = [];
      for (const raw of txLogs) {
        const inReceipt = receipt.logs.some(
          (r) => r.index === raw.index && r.blockHash === raw.blockHash && r.address.toLowerCase() === raw.address.toLowerCase(),
        );
        if (!inReceipt) {
          this.log.warn(`indexer: log ${txHash}#${raw.index} not present in receipt – skipped`);
          continue;
        }
        const p = this.parse(raw);
        if (p) parsed.push(p);
      }
      if (!parsed.length) continue;

      // 2. Store raw events idempotently (unique txHash+logIndex).
      const timestamp = await blockTime(receipt.blockNumber);
      const sender = receipt.from.toLowerCase();
      const ops = parsed.map((p) => ({
        updateOne: {
          filter: { txHash, logIndex: p.raw.index },
          update: {
            $setOnInsert: {
              txHash,
              logIndex: p.raw.index,
              blockNumber: p.raw.blockNumber,
              blockHash: p.raw.blockHash,
              contract: p.contract,
              contractAddress: p.raw.address.toLowerCase(),
              eventName: p.desc.name,
              args: p.args,
              batchId: p.batchId,
              orderId: p.orderId,
              participants: p.addresses,
              sender,
              timestamp,
            },
          },
          upsert: true,
        },
      }));
      const res = await ChainEvent.bulkWrite(ops, { ordered: false });
      inserted += res.upsertedCount;

      // 3. One transaction summary per hash.
      const summary = this.summarise(parsed, sender);
      await Transaction.updateOne(
        { hash: txHash },
        {
          $set: {
            hash: txHash,
            blockNumber: receipt.blockNumber,
            from: sender,
            to: receipt.to?.toLowerCase(),
            contract: receipt.to ? this.ifaces.get(receipt.to.toLowerCase())?.name : undefined,
            status: "success",
            timestamp,
            ...summary,
          },
        },
        { upsert: true },
      );

      // 4. Collect projections to refresh from the authoritative chain state.
      for (const p of parsed) {
        if (p.batchId !== undefined) {
          batchIds.add(p.batchId);
          if (!batchParticipants.has(p.batchId)) batchParticipants.set(p.batchId, new Set());
          p.addresses.forEach((a) => batchParticipants.get(p.batchId!)!.add(a));
          if (p.desc.name === "BatchRegistered") registrationTx.set(p.batchId, txHash);
        }
        if (USER_EVENTS.has(p.desc.name)) {
          const account = String(p.args.account ?? "").toLowerCase();
          if (account) {
            users.add(account);
            if (p.desc.name === "UserRegistered") userRegistrationTx.set(account, txHash);
          }
        }
      }
    }

    await this.refreshBatches(batchIds, batchParticipants, registrationTx);
    await this.refreshUsers(users, userRegistrationTx);
    return inserted;
  }

  private parse(raw: RawLog): ParsedLog | null {
    const entry = this.ifaces.get(raw.address.toLowerCase());
    if (!entry) return null;
    let desc: LogDescription | null = null;
    try {
      desc = entry.iface.parseLog({ topics: [...raw.topics], data: raw.data });
    } catch {
      return null;
    }
    if (!desc) return null;

    const args: Record<string, unknown> = {};
    const addresses = new Set<string>();
    desc.fragment.inputs.forEach((input, i) => {
      const v = desc!.args[i];
      if (input.type === "address") {
        const a = String(v).toLowerCase();
        args[input.name] = a;
        if (a !== ZeroAddress) addresses.add(a);
      } else if (typeof v === "bigint") {
        args[input.name] = v.toString();
      } else {
        args[input.name] = v;
      }
    });
    if (desc.name === "HistoryRecorded") args.actionName = ACTION_NAMES[Number(args.action)] ?? "Unknown";

    const batchId = args.batchId !== undefined ? Number(args.batchId) : undefined;
    const orderId = args.orderId !== undefined ? Number(args.orderId) : undefined;
    return { raw, contract: entry.name, desc, args, addresses: [...addresses], batchId, orderId };
  }

  private summarise(parsed: ParsedLog[], sender: string) {
    const names = parsed.map((p) => p.desc.name);
    const primaryName = OPERATION_PRIORITY.find((n) => names.includes(n)) ?? names[0];
    const primary = parsed.find((p) => p.desc.name === primaryName)!;
    let operation = primaryName;
    if (primaryName === "HistoryRecorded") operation = String(primary.args.actionName);
    if (primaryName === "Transfer" && primary.contract === "FarmChainTestToken") operation = "TokenTransfer";
    if (primaryName === "Approval") operation = "TokenApproval";

    const participants = new Set<string>([sender]);
    parsed.forEach((p) => p.addresses.forEach((a) => participants.add(a)));
    const contractAddrs = new Set(this.addressList);
    const counterparty =
      [String(primary.args.to ?? ""), String(primary.args.from ?? ""), String(primary.args.seller ?? ""), String(primary.args.buyer ?? ""), String(primary.args.account ?? "")]
        .map((a) => a.toLowerCase())
        .find((a) => a.startsWith("0x") && a !== sender && !contractAddrs.has(a)) ?? null;

    return {
      operation,
      events: [...new Set(names)],
      batchId: parsed.find((p) => p.batchId !== undefined)?.batchId,
      orderId: parsed.find((p) => p.orderId !== undefined)?.orderId,
      counterparty,
      participants: [...participants].filter((a) => !contractAddrs.has(a)),
    };
  }

  private async refreshBatches(ids: Set<number>, participants: Map<number, Set<string>>, regTx: Map<number, string>) {
    for (const id of ids) {
      const b = await this.opts.reader.getBatch(id);
      if (!b) continue;
      const extra = [...(participants.get(id) ?? [])];
      await Product.updateOne(
        { batchId: id },
        {
          $set: { ...b, lastSyncedAt: new Date(), ...(regTx.has(id) ? { registrationTx: regTx.get(id) } : {}) },
          $addToSet: { participants: { $each: [...new Set([b.farmer, b.currentOwner, ...extra])] } },
        },
        { upsert: true },
      );
    }
  }

  private async refreshUsers(wallets: Set<string>, regTx: Map<string, string>) {
    for (const wallet of wallets) {
      const u = await this.opts.reader.getUser(wallet);
      if (!u) continue;
      await User.updateOne(
        { wallet },
        {
          $set: {
            name: u.name,
            organization: u.organization,
            location: u.location,
            role: u.role,
            verificationStatus: u.verificationStatus,
            roleActive: u.roleActive,
            registeredOnChain: true,
            registeredAt: u.registeredAt,
            lastSyncedAt: new Date(),
            ...(regTx.has(wallet) ? { registrationTx: regTx.get(wallet) } : {}),
          },
        },
        { upsert: true },
      );
    }
  }

  private async resetIndex() {
    await Promise.all([ChainEvent.deleteMany({}), Transaction.deleteMany({}), Product.deleteMany({})]);
    // Keep private off-chain profile data, but forget everything derived from the old chain.
    await User.updateMany(
      {},
      { $set: { registeredOnChain: false, verificationStatus: "Pending", roleActive: false, role: "None" }, $unset: { registrationTx: 1 } },
    );
  }

  private async saveState(lastBlock: number, lastBlockHash: string | null) {
    const doc = await SyncState.findOneAndUpdate(
      { key: STATE_KEY },
      { $set: { chainId: this.opts.chainId, fingerprint: this.fingerprint, lastBlock, lastBlockHash, updatedAt: new Date() } },
      { upsert: true, new: true },
    );
    return doc!;
  }
}
