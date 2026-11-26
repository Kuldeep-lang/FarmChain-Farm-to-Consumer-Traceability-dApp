import { getAddress, isAddress, type InterfaceAbi } from "ethers";
import abisJson from "@/abi/abis.json";
import deploymentsJson from "@/abi/deployments.json";

export type ContractKey =
  | "RoleManager"
  | "UserRegistry"
  | "ProductRegistry"
  | "SupplyChainTracker"
  | "PaymentEscrow"
  | "FarmChainTestToken";

export const abis = abisJson as unknown as Record<ContractKey, InterfaceAbi>;

interface NetworkInfo {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorer: string | null;
  currency: { name: string; symbol: string; decimals: number };
}

const KNOWN: Record<number, Omit<NetworkInfo, "rpcUrl"> & { rpcUrl?: string }> = {
  31337: { chainId: 31337, name: "Hardhat Local", rpcUrl: "http://127.0.0.1:8545", explorer: null, currency: { name: "Ether", symbol: "ETH", decimals: 18 } },
  11155111: { chainId: 11155111, name: "Sepolia", rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com", explorer: "https://sepolia.etherscan.io", currency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 } },
};

const chainId = Number(import.meta.env.VITE_CHAIN_ID || 31337);
const known = KNOWN[chainId];

export const NETWORK: NetworkInfo = {
  chainId,
  name: known?.name ?? `Chain ${chainId}`,
  rpcUrl: import.meta.env.VITE_RPC_URL || known?.rpcUrl || "http://127.0.0.1:8545",
  explorer: known?.explorer ?? null,
  currency: known?.currency ?? { name: "Ether", symbol: "ETH", decimals: 18 },
};

export const networkName = (id: number | null | undefined) => (id ? (KNOWN[id]?.name ?? `Chain ${id}`) : "Unknown");

const deployment = (deploymentsJson as Record<string, { contracts: Record<ContractKey, string>; startBlock: number }>)[String(chainId)];

const envAddr: Record<ContractKey, string | undefined> = {
  RoleManager: import.meta.env.VITE_CONTRACT_ADDRESS_ROLE_MANAGER,
  UserRegistry: import.meta.env.VITE_CONTRACT_ADDRESS_USER_REGISTRY,
  ProductRegistry: import.meta.env.VITE_CONTRACT_ADDRESS_PRODUCT_REGISTRY,
  SupplyChainTracker: import.meta.env.VITE_CONTRACT_ADDRESS_SUPPLY_CHAIN,
  PaymentEscrow: import.meta.env.VITE_CONTRACT_ADDRESS_PAYMENT_ESCROW,
  FarmChainTestToken: import.meta.env.VITE_CONTRACT_ADDRESS_PAYMENT_TOKEN,
};

export const ADDRESSES = {} as Record<ContractKey, string>;
for (const key of Object.keys(envAddr) as ContractKey[]) {
  const a = envAddr[key] || deployment?.contracts?.[key];
  if (a && isAddress(a)) ADDRESSES[key] = getAddress(a);
}

export const CONTRACTS_READY = (Object.keys(envAddr) as ContractKey[]).every((k) => ADDRESSES[k]);
export const DEPLOYMENT_START_BLOCK = deployment?.startBlock ?? 0;

export const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:5000/api").replace(/\/+$/, "");
export const IPFS_GATEWAY = (import.meta.env.VITE_IPFS_GATEWAY || "https://gateway.pinata.cloud/ipfs").replace(/\/+$/, "");
export const PUBLIC_APP_URL = (import.meta.env.VITE_PUBLIC_APP_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:5173")).replace(/\/+$/, "");

export const ipfsUrl = (cid: string) => `${IPFS_GATEWAY}/${cid}`;
export const traceUrl = (batchId: number | string) => `${PUBLIC_APP_URL}/trace/${batchId}`;
export const txExplorerUrl = (hash: string) => (NETWORK.explorer ? `${NETWORK.explorer}/tx/${hash}` : null);
export const addressExplorerUrl = (addr: string) => (NETWORK.explorer ? `${NETWORK.explorer}/address/${addr}` : null);
