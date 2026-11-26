import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Hardhat Ignition module (alternative to scripts/deploy.ts).
 *   npx hardhat ignition deploy ignition/modules/FarmChain.ts --network localhost
 * Note: scripts/deploy.ts is the recommended path because it also exports ABIs/addresses
 * to the frontend and backend.
 */
export default buildModule("FarmChain", (m) => {
  const admin = m.getAccount(0);

  const roleManager = m.contract("RoleManager", [admin]);
  const userRegistry = m.contract("UserRegistry", [roleManager]);
  m.call(roleManager, "setUserRegistry", [userRegistry]);

  const productRegistry = m.contract("ProductRegistry", [roleManager]);
  const tracker = m.contract("SupplyChainTracker", [roleManager, productRegistry]);
  m.call(productRegistry, "setTracker", [tracker]);

  const token = m.contract("FarmChainTestToken", [admin, 1_000_000n * 10n ** 18n]);
  const escrow = m.contract("PaymentEscrow", [token, roleManager, productRegistry]);

  return { roleManager, userRegistry, productRegistry, tracker, token, escrow };
});
