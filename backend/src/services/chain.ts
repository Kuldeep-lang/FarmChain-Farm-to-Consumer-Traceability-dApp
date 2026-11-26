import { Contract, JsonRpcProvider, type Provider } from "ethers";
import { env } from "../config/env.js";
import { abis, addresses, contractsConfigured, type ContractKey } from "../config/contracts.js";
import { ROLE_NAMES, STAGE_NAMES, VERIFICATION_NAMES } from "../utils/chainEnums.js";

/** Read-only access to the FarmChain contracts (the authoritative source of truth). */
export interface OnChainUser {
  wallet: string;
  name: string;
  organization: string;
  location: string;
  role: (typeof ROLE_NAMES)[number];
  registeredAt: Date;
  updatedAt: Date;
  verificationStatus: (typeof VERIFICATION_NAMES)[number];
  roleActive: boolean;
}

export interface OnChainBatch {
  batchId: number;
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
  status: (typeof STAGE_NAMES)[number];
  pendingTransferTo: string | null;
}

export interface ChainReader {
  getUser(wallet: string): Promise<OnChainUser | null>;
  getBatch(batchId: number): Promise<OnChainBatch | null>;
  isAdmin(wallet: string): Promise<boolean>;
  isRegistered(wallet: string): Promise<boolean>;
}

let provider: JsonRpcProvider | null = null;
export function getProvider(): JsonRpcProvider {
  if (!provider) provider = new JsonRpcProvider(env.RPC_URL, env.CHAIN_ID, { staticNetwork: true });
  return provider;
}

export function getContract(key: ContractKey, runner: Provider = getProvider()): Contract {
  const address = addresses[key];
  if (!address) throw new Error(`Contract address for ${key} is not configured`);
  return new Contract(address, abis[key], runner);
}

const toDate = (s: bigint | number) => new Date(Number(s) * 1000);

export function createChainReader(runner: Provider = getProvider()): ChainReader {
  if (!contractsConfigured) {
    const fail = async () => {
      throw new Error("Contracts are not configured. Deploy them and export ABIs (see README).");
    };
    return { getUser: fail, getBatch: fail, isAdmin: fail, isRegistered: fail };
  }
  const roleManager = getContract("RoleManager", runner);
  const userRegistry = getContract("UserRegistry", runner);
  const productRegistry = getContract("ProductRegistry", runner);
  const tracker = getContract("SupplyChainTracker", runner);

  return {
    async isRegistered(wallet) {
      return (await userRegistry.isRegistered(wallet)) as boolean;
    },
    async isAdmin(wallet) {
      return (await roleManager.isAdmin(wallet)) as boolean;
    },
    async getUser(wallet) {
      if (!(await userRegistry.isRegistered(wallet))) return null;
      const u = await userRegistry.getUser(wallet);
      return {
        wallet: u.wallet.toLowerCase(),
        name: u.name,
        organization: u.organization,
        location: u.location,
        role: ROLE_NAMES[Number(u.role)],
        registeredAt: toDate(u.registeredAt),
        updatedAt: toDate(u.updatedAt),
        verificationStatus: VERIFICATION_NAMES[Number(u.verification)],
        roleActive: u.roleActive,
      };
    },
    async getBatch(batchId) {
      if (!(await productRegistry.batchExists(batchId))) return null;
      const [b, pending] = await Promise.all([productRegistry.getBatch(batchId), tracker.getPendingTransfer(batchId)]);
      return {
        batchId: Number(b.id),
        farmer: b.farmer.toLowerCase(),
        productName: b.productName,
        category: b.category,
        quantity: Number(b.quantity),
        unit: b.unit,
        harvestDate: toDate(b.harvestDate),
        farmLocation: b.farmLocation,
        metadataCID: b.metadataCID,
        createdAt: toDate(b.createdAt),
        currentOwner: b.currentOwner.toLowerCase(),
        status: STAGE_NAMES[Number(b.status)],
        pendingTransferTo: pending.active ? (pending.to as string).toLowerCase() : null,
      };
    },
  };
}
