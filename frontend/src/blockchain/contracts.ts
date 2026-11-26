import { Contract, Interface, JsonRpcProvider, type ContractRunner } from "ethers";
import { ADDRESSES, abis, NETWORK, type ContractKey } from "./config";

let readProvider: JsonRpcProvider | null = null;

/** Read-only provider for public pages – consumers never need a wallet. */
export function getReadProvider(): JsonRpcProvider {
  if (!readProvider) readProvider = new JsonRpcProvider(NETWORK.rpcUrl, NETWORK.chainId, { staticNetwork: true });
  return readProvider;
}

export function getContract(key: ContractKey, runner: ContractRunner = getReadProvider()): Contract {
  const address = ADDRESSES[key];
  if (!address) throw new Error(`${key} address is not configured. Deploy the contracts and export ABIs.`);
  return new Contract(address, abis[key], runner);
}

export function contracts(runner: ContractRunner = getReadProvider()) {
  return {
    roleManager: getContract("RoleManager", runner),
    userRegistry: getContract("UserRegistry", runner),
    productRegistry: getContract("ProductRegistry", runner),
    tracker: getContract("SupplyChainTracker", runner),
    escrow: getContract("PaymentEscrow", runner),
    token: getContract("FarmChainTestToken", runner),
  };
}

/** Combined interface used to decode custom errors from any FarmChain contract. */
let combined: Interface | null = null;
export function combinedInterface(): Interface {
  if (!combined) {
    const seen = new Set<string>();
    const fragments: unknown[] = [];
    for (const abi of Object.values(abis) as unknown[][]) {
      for (const f of abi as { type: string; name?: string; inputs?: { type: string }[] }[]) {
        if (f.type !== "error") continue;
        const sig = `${f.name}(${(f.inputs ?? []).map((i) => i.type).join(",")})`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        fragments.push(f);
      }
    }
    combined = new Interface(fragments as never);
  }
  return combined;
}
