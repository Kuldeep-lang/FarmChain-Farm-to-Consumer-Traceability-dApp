import { ethers, network } from "hardhat";
import { exportToApps, saveDeployment, DeploymentRecord } from "./lib/deployment";

/**
 * Deploys and wires all FarmChain contracts:
 *   RoleManager -> UserRegistry -> ProductRegistry -> SupplyChainTracker -> TestToken -> PaymentEscrow
 * then exports ABIs and addresses to frontend/src/abi and backend/src/abi.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  const startBlock = await ethers.provider.getBlockNumber();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`\nDeploying FarmChain to "${network.name}" (chainId ${chainId})`);
  console.log(`  deployer: ${deployer.address} (balance ${ethers.formatEther(balance)} ETH)`);
  if (network.name === "sepolia" && balance === 0n) throw new Error("Deployer has no Sepolia ETH. Fund it from a faucet first.");

  const wait = async <T extends { waitForDeployment(): Promise<unknown>; getAddress(): Promise<string> }>(label: string, p: Promise<T>) => {
    const c = await p;
    await c.waitForDeployment();
    console.log(`  ${label.padEnd(20)} ${await c.getAddress()}`);
    return c;
  };
  const confirm = async (label: string, tx: Promise<{ wait(): Promise<unknown> }>) => {
    await (await tx).wait();
    console.log(`  ✓ ${label}`);
  };

  const roleManager = await wait("RoleManager", ethers.deployContract("RoleManager", [deployer.address]));
  const userRegistry = await wait("UserRegistry", ethers.deployContract("UserRegistry", [await roleManager.getAddress()]));
  await confirm("RoleManager.setUserRegistry", roleManager.setUserRegistry(await userRegistry.getAddress()));
  const productRegistry = await wait("ProductRegistry", ethers.deployContract("ProductRegistry", [await roleManager.getAddress()]));
  const tracker = await wait(
    "SupplyChainTracker",
    ethers.deployContract("SupplyChainTracker", [await roleManager.getAddress(), await productRegistry.getAddress()]),
  );
  await confirm("ProductRegistry.setTracker", productRegistry.setTracker(await tracker.getAddress()));
  const token = await wait(
    "FarmChainTestToken",
    ethers.deployContract("FarmChainTestToken", [deployer.address, ethers.parseEther("1000000")]),
  );
  const escrow = await wait(
    "PaymentEscrow",
    ethers.deployContract("PaymentEscrow", [
      await token.getAddress(),
      await roleManager.getAddress(),
      await productRegistry.getAddress(),
    ]),
  );

  // Optional extra administrators (e.g. a separate admin MetaMask wallet).
  const extraAdmins = (process.env.ADDITIONAL_ADMINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const a of extraAdmins) {
    if (!ethers.isAddress(a)) throw new Error(`ADDITIONAL_ADMINS contains an invalid address: ${a}`);
    await confirm(`grant admin to ${a}`, roleManager.grantRole(await roleManager.DEFAULT_ADMIN_ROLE(), a));
  }

  const record: DeploymentRecord = {
    network: network.name,
    chainId: Number(chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    startBlock,
    contracts: {
      RoleManager: await roleManager.getAddress(),
      UserRegistry: await userRegistry.getAddress(),
      ProductRegistry: await productRegistry.getAddress(),
      SupplyChainTracker: await tracker.getAddress(),
      PaymentEscrow: await escrow.getAddress(),
      FarmChainTestToken: await token.getAddress(),
    },
  };
  const file = saveDeployment(record);
  console.log(`\nSaved deployment -> ${file}`);
  await exportToApps(record);

  console.log("\nEnvironment values (optional – the apps also read deployments.json automatically):");
  console.log(`  CHAIN_ID=${record.chainId}`);
  console.log(`  CONTRACT_ADDRESS_ROLE_MANAGER=${record.contracts.RoleManager}`);
  console.log(`  CONTRACT_ADDRESS_USER_REGISTRY=${record.contracts.UserRegistry}`);
  console.log(`  CONTRACT_ADDRESS_PRODUCT_REGISTRY=${record.contracts.ProductRegistry}`);
  console.log(`  CONTRACT_ADDRESS_SUPPLY_CHAIN=${record.contracts.SupplyChainTracker}`);
  console.log(`  CONTRACT_ADDRESS_PAYMENT_ESCROW=${record.contracts.PaymentEscrow}`);
  console.log(`  CONTRACT_ADDRESS_PAYMENT_TOKEN=${record.contracts.FarmChainTestToken}`);
  console.log(`  INDEXER_START_BLOCK=${record.startBlock}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
