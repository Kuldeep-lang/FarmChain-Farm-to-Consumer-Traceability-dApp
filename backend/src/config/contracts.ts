import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getAddress, isAddress, type InterfaceAbi } from "ethers";
import { env } from "./env.js";

const here = dirname(fileURLToPath(import.meta.url));
// Works from both src/ (tsx) and dist/ (compiled): abi folder lives in src/abi.
const ABI_DIRS = [join(here, "..", "abi"), join(here, "..", "..", "src", "abi")];

function readJson<T>(file: string, fallback: T): T {
  for (const dir of ABI_DIRS) {
    const p = join(dir, file);
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8")) as T;
  }
  return fallback;
}

export type ContractKey =
  | "RoleManager"
  | "UserRegistry"
  | "ProductRegistry"
  | "SupplyChainTracker"
  | "PaymentEscrow"
  | "FarmChainTestToken";

interface DeploymentEntry {
  network: string;
  startBlock: number;
  contracts: Record<ContractKey, string>;
}

export const abis = readJson<Record<ContractKey, InterfaceAbi>>("abis.json", {} as Record<ContractKey, InterfaceAbi>);
const deployments = readJson<Record<string, DeploymentEntry>>("deployments.json", {});
const deployment = deployments[String(env.CHAIN_ID)];

const envAddress: Record<ContractKey, string | undefined> = {
  RoleManager: env.CONTRACT_ADDRESS_ROLE_MANAGER,
  UserRegistry: env.CONTRACT_ADDRESS_USER_REGISTRY,
  ProductRegistry: env.CONTRACT_ADDRESS_PRODUCT_REGISTRY,
  SupplyChainTracker: env.CONTRACT_ADDRESS_SUPPLY_CHAIN,
  PaymentEscrow: env.CONTRACT_ADDRESS_PAYMENT_ESCROW,
  FarmChainTestToken: env.CONTRACT_ADDRESS_PAYMENT_TOKEN,
};

export const CONTRACT_KEYS: ContractKey[] = [
  "RoleManager",
  "UserRegistry",
  "ProductRegistry",
  "SupplyChainTracker",
  "PaymentEscrow",
  "FarmChainTestToken",
];

/** Contract addresses: explicit env vars win over deployments.json. */
export const addresses: Partial<Record<ContractKey, string>> = {};
for (const key of CONTRACT_KEYS) {
  const candidate = envAddress[key] ?? deployment?.contracts?.[key];
  if (candidate && isAddress(candidate)) addresses[key] = getAddress(candidate);
}

export const contractsConfigured = CONTRACT_KEYS.every((k) => addresses[k]) && Object.keys(abis).length > 0;

export const deploymentStartBlock = env.INDEXER_START_BLOCK !== undefined ? Number(env.INDEXER_START_BLOCK) : (deployment?.startBlock ?? 0);
