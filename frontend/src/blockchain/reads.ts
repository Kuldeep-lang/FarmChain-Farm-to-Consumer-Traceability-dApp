import { ZeroAddress, type ContractRunner, type EventLog } from "ethers";
import { contracts } from "./contracts";
import { DEPLOYMENT_START_BLOCK } from "./config";
import { ACTIONS, ORDER_STATUS, ROLES, STAGES, VERIFICATION, type ActionName, type OrderStatusName, type RoleName, type StageName, type VerificationName } from "./enums";
import { api } from "@/services/api";

/* ------------------------------------------------------------------ types */

export interface Participant {
  wallet: string;
  name: string;
  organization: string;
  location: string;
  role: RoleName;
  registeredAt: Date;
  updatedAt: Date;
  verification: VerificationName;
  roleActive: boolean;
}

export interface Batch {
  id: number;
  farmer: string;
  productName: string;
  category: string;
  quantity: number;
  unit: string;
  harvestDate: Date;
  farmLocation: string;
  metadataCID: string;
  createdAt: Date;
  currentOwner: string;
  status: StageName;
}

export interface PendingTransfer {
  from: string;
  to: string;
  createdAt: Date;
  location: string;
  metadataCID: string;
  active: boolean;
}

export interface HistoryEntry {
  index: number;
  batchId: number;
  action: ActionName;
  stage: StageName;
  previousOwner: string;
  newOwner: string;
  actor: string;
  timestamp: Date;
  location: string;
  metadataCID: string;
  txHash: string | null;
  txHashSource: "chain" | "indexer" | null;
}

export interface Order {
  id: number;
  batchId: number;
  buyer: string;
  seller: string;
  amount: bigint;
  createdAt: Date;
  fundedAt: Date | null;
  deliveryWindow: number;
  deliveryDeadline: Date | null;
  deliveredAt: Date | null;
  status: OrderStatusName;
  deliveryConfirmed: boolean;
}

const date = (s: bigint | number) => new Date(Number(s) * 1000);
const optDate = (s: bigint | number) => (Number(s) === 0 ? null : date(s));

/* ------------------------------------------------------------------ mappers */

export function toBatch(b: any): Batch {
  return {
    id: Number(b.id),
    farmer: b.farmer,
    productName: b.productName,
    category: b.category,
    quantity: Number(b.quantity),
    unit: b.unit,
    harvestDate: date(b.harvestDate),
    farmLocation: b.farmLocation,
    metadataCID: b.metadataCID,
    createdAt: date(b.createdAt),
    currentOwner: b.currentOwner,
    status: STAGES[Number(b.status)],
  };
}

function toParticipant(u: any): Participant {
  return {
    wallet: u.wallet,
    name: u.name,
    organization: u.organization,
    location: u.location,
    role: ROLES[Number(u.role)],
    registeredAt: date(u.registeredAt),
    updatedAt: date(u.updatedAt),
    verification: VERIFICATION[Number(u.verification)],
    roleActive: u.roleActive,
  };
}

function toOrder(o: any): Order {
  return {
    id: Number(o.id),
    batchId: Number(o.batchId),
    buyer: o.buyer,
    seller: o.seller,
    amount: o.amount as bigint,
    createdAt: date(o.createdAt),
    fundedAt: optDate(o.fundedAt),
    deliveryWindow: Number(o.deliveryWindow),
    deliveryDeadline: optDate(o.deliveryDeadline),
    deliveredAt: optDate(o.deliveredAt),
    status: ORDER_STATUS[Number(o.status)],
    deliveryConfirmed: o.deliveryConfirmed,
  };
}

/* ------------------------------------------------------------------ participants */

export async function fetchParticipant(wallet: string, runner?: ContractRunner): Promise<Participant | null> {
  const { userRegistry } = contracts(runner);
  if (!(await userRegistry.isRegistered(wallet))) return null;
  return toParticipant(await userRegistry.getUser(wallet));
}

export interface WalletStatus {
  participant: Participant | null;
  isAdmin: boolean;
}

export async function fetchWalletStatus(wallet: string): Promise<WalletStatus> {
  const { roleManager } = contracts();
  const [participant, isAdmin] = await Promise.all([fetchParticipant(wallet), roleManager.isAdmin(wallet) as Promise<boolean>]);
  return { participant, isAdmin };
}

/** All registered participants, read directly from the chain (paginated contract call). */
export async function fetchAllParticipants(): Promise<Participant[]> {
  const { userRegistry } = contracts();
  const total = Number(await userRegistry.totalUsers());
  const wallets: string[] = [];
  for (let offset = 0; offset < total; offset += 100) wallets.push(...((await userRegistry.getUsers(offset, 100)) as string[]));
  const users = await Promise.all(wallets.map((w) => userRegistry.getUser(w)));
  return users.map(toParticipant);
}

/* ------------------------------------------------------------------ batches */

export async function fetchBatch(id: number): Promise<Batch | null> {
  const { productRegistry } = contracts();
  if (!(await productRegistry.batchExists(id))) return null;
  return toBatch(await productRegistry.getBatch(id));
}

export async function fetchPendingTransfer(id: number): Promise<PendingTransfer | null> {
  const p = await contracts().tracker.getPendingTransfer(id);
  if (!p.active) return null;
  return { from: p.from, to: p.to, createdAt: date(p.createdAt), location: p.location, metadataCID: p.metadataCID, active: true };
}

export interface BatchWithPending extends Batch {
  pending: PendingTransfer | null;
}

async function withPending(ids: number[]): Promise<BatchWithPending[]> {
  const { productRegistry, tracker } = contracts();
  const rows = await Promise.all(
    ids.map(async (id) => {
      const [b, p] = await Promise.all([productRegistry.getBatch(id), tracker.getPendingTransfer(id)]);
      const pending: PendingTransfer | null = p.active
        ? { from: p.from, to: p.to, createdAt: date(p.createdAt), location: p.location, metadataCID: p.metadataCID, active: true }
        : null;
      return { ...toBatch(b), pending };
    }),
  );
  return rows.sort((a, b) => b.id - a.id);
}

export async function fetchFarmerBatches(farmer: string): Promise<BatchWithPending[]> {
  const ids = ((await contracts().productRegistry.getFarmerBatches(farmer)) as bigint[]).map(Number);
  return withPending(ids);
}

/** Every batch the wallet has owned or been offered (on-chain index in SupplyChainTracker). */
export async function fetchParticipantBatches(wallet: string): Promise<BatchWithPending[]> {
  const ids = ((await contracts().tracker.getParticipantBatches(wallet)) as bigint[]).map(Number);
  return withPending(ids);
}

/**
 * Full history from SupplyChainTracker.getBatchHistory (authoritative), with transaction hashes
 * resolved from HistoryRecorded logs. If the RPC refuses the log query (range limits on public
 * Sepolia RPCs) hashes fall back to the backend indexer and are labelled as such.
 */
export async function fetchBatchHistory(id: number): Promise<HistoryEntry[]> {
  const { tracker } = contracts();
  const raw = (await tracker.getBatchHistory(id)) as any[];
  const hashes = new Map<number, string>();
  let source: "chain" | "indexer" | null = null;
  try {
    const logs = (await tracker.queryFilter(tracker.filters.HistoryRecorded(id), DEPLOYMENT_START_BLOCK)) as EventLog[];
    for (const l of logs) hashes.set(Number(l.args.index), l.transactionHash);
    source = "chain";
  } catch {
    try {
      const events = await api.productEvents(id);
      for (const e of events) if (e.eventName === "HistoryRecorded") hashes.set(Number(e.args.index), e.txHash);
      source = hashes.size ? "indexer" : null;
    } catch {
      source = null;
    }
  }
  return raw.map((h, index) => ({
    index,
    batchId: Number(h.batchId),
    action: ACTIONS[Number(h.action)],
    stage: STAGES[Number(h.stage)],
    previousOwner: h.previousOwner,
    newOwner: h.newOwner,
    actor: h.actor,
    timestamp: date(h.timestamp),
    location: h.location,
    metadataCID: h.metadataCID,
    txHash: hashes.get(index) ?? null,
    txHashSource: hashes.has(index) ? source : null,
  }));
}

export const isZero = (a: string) => !a || a === ZeroAddress;

/* ------------------------------------------------------------------ escrow */

export async function fetchOrders(wallet: string): Promise<Order[]> {
  const { escrow } = contracts();
  const ids = [...new Set(((await escrow.getUserOrders(wallet)) as bigint[]).map(Number))];
  const orders = await Promise.all(ids.map((i) => escrow.getOrderDetails(i)));
  return orders.map(toOrder).sort((a, b) => b.id - a.id);
}

export async function fetchTokenInfo(wallet: string) {
  const { token, escrow } = contracts();
  const [balance, allowance, lastFaucet] = await Promise.all([
    token.balanceOf(wallet) as Promise<bigint>,
    token.allowance(wallet, await escrow.getAddress()) as Promise<bigint>,
    token.lastFaucetAt(wallet) as Promise<bigint>,
  ]);
  return { balance, allowance, lastFaucetAt: Number(lastFaucet) };
}

export async function fetchChainTotals() {
  const { productRegistry, userRegistry, escrow } = contracts();
  const [batches, users, orders] = await Promise.all([productRegistry.totalBatches(), userRegistry.totalUsers(), escrow.totalOrders()]);
  return { batches: Number(batches), users: Number(users), orders: Number(orders) };
}

export async function fetchPauseState() {
  const { productRegistry, tracker, escrow } = contracts();
  const [p, t, e] = await Promise.all([productRegistry.paused(), tracker.paused(), escrow.paused()]);
  return { ProductRegistry: p as boolean, SupplyChainTracker: t as boolean, PaymentEscrow: e as boolean };
}
