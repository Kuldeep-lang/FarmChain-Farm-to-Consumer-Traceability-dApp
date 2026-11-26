import * as fs from "fs";
import * as path from "path";
import { artifacts } from "hardhat";

export const CONTRACT_NAMES = [
  "RoleManager",
  "UserRegistry",
  "ProductRegistry",
  "SupplyChainTracker",
  "PaymentEscrow",
  "FarmChainTestToken",
] as const;
export type ContractName = (typeof CONTRACT_NAMES)[number];

export interface DeploymentRecord {
  network: string;
  chainId: number;
  deployer: string;
  deployedAt: string;
  startBlock: number;
  contracts: Record<ContractName, string>;
}

const ROOT = path.resolve(__dirname, "..", "..", "..");
export const DEPLOYMENTS_DIR = path.resolve(__dirname, "..", "..", "deployments");
const EXPORT_TARGETS = [path.join(ROOT, "frontend", "src", "abi"), path.join(ROOT, "backend", "src", "abi")];

export function saveDeployment(record: DeploymentRecord) {
  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  const file = path.join(DEPLOYMENTS_DIR, `${record.network}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  return file;
}

export function loadDeployment(network: string): DeploymentRecord {
  const file = path.join(DEPLOYMENTS_DIR, `${network}.json`);
  if (!fs.existsSync(file)) throw new Error(`No deployment found for network "${network}" (${file}). Run the deploy script first.`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Writes `abis.json` (all contract ABIs) and merges this deployment into `deployments.json`
 * (keyed by chainId) for both the frontend and the backend.
 */
export async function exportToApps(record?: DeploymentRecord) {
  const abis: Record<string, unknown> = {};
  for (const name of CONTRACT_NAMES) abis[name] = (await artifacts.readArtifact(name)).abi;

  for (const dir of EXPORT_TARGETS) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "abis.json"), JSON.stringify(abis, null, 2));
    const depFile = path.join(dir, "deployments.json");
    const existing = fs.existsSync(depFile) ? JSON.parse(fs.readFileSync(depFile, "utf8")) : {};
    if (record) {
      existing[String(record.chainId)] = {
        network: record.network,
        startBlock: record.startBlock,
        deployedAt: record.deployedAt,
        contracts: record.contracts,
      };
    }
    fs.writeFileSync(depFile, JSON.stringify(existing, null, 2));
    console.log(`  exported ABIs${record ? " + addresses" : ""} -> ${path.relative(ROOT, dir)}`);
  }
}
