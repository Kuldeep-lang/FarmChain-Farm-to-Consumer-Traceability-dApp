import { run, network } from "hardhat";
import { ethers } from "hardhat";
import { loadDeployment } from "./lib/deployment";

/** Verifies every deployed contract's source on Etherscan (requires ETHERSCAN_API_KEY). */
async function main() {
  const d = loadDeployment(network.name);
  const c = d.contracts;
  const jobs: [string, string, unknown[]][] = [
    ["RoleManager", c.RoleManager, [d.deployer]],
    ["UserRegistry", c.UserRegistry, [c.RoleManager]],
    ["ProductRegistry", c.ProductRegistry, [c.RoleManager]],
    ["SupplyChainTracker", c.SupplyChainTracker, [c.RoleManager, c.ProductRegistry]],
    ["FarmChainTestToken", c.FarmChainTestToken, [d.deployer, ethers.parseEther("1000000")]],
    ["PaymentEscrow", c.PaymentEscrow, [c.FarmChainTestToken, c.RoleManager, c.ProductRegistry]],
  ];
  for (const [name, address, args] of jobs) {
    try {
      await run("verify:verify", { address, constructorArguments: args });
      console.log(`✓ verified ${name}`);
    } catch (e) {
      const msg = (e as Error).message;
      console.log(msg.includes("Already Verified") ? `✓ ${name} already verified` : `✗ ${name}: ${msg}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
