import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

export const Role = { None: 0, Farmer: 1, Distributor: 2, Warehouse: 3, Retailer: 4 } as const;
export const Stage = {
  HARVESTED: 0,
  REGISTERED: 1,
  IN_TRANSIT: 2,
  AT_WAREHOUSE: 3,
  QUALITY_CHECKED: 4,
  OUT_FOR_DELIVERY: 5,
  AT_RETAILER: 6,
  AVAILABLE_FOR_SALE: 7,
  SOLD: 8,
  RECALLED: 9,
} as const;
export const Verification = { Unverified: 0, Verified: 1, Rejected: 2, Revoked: 3 } as const;
export const Action = {
  Harvested: 0,
  Registered: 1,
  TransferInitiated: 2,
  TransferAccepted: 3,
  TransferRejected: 4,
  TransferCancelled: 5,
  ShipmentRecorded: 6,
  WarehouseArrival: 7,
  QualityInspectionPassed: 8,
  QualityInspectionFailed: 9,
  RetailArrival: 10,
  OutForDelivery: 11,
  AvailableForSale: 12,
  Sold: 13,
  Recalled: 14,
  MetadataUpdated: 15,
} as const;
export const OrderStatus = { Created: 0, Funded: 1, Released: 2, Refunded: 3, Cancelled: 4 } as const;

export const FIRST_BATCH_ID = 10001n;

/** Deploys and wires every contract exactly like scripts/deploy.ts. */
export async function deployContracts() {
  const [admin, farmer, distributor, warehouse, retailer, outsider, farmer2, distributor2] = await ethers.getSigners();

  const roleManager = await ethers.deployContract("RoleManager", [admin.address]);
  const userRegistry = await ethers.deployContract("UserRegistry", [await roleManager.getAddress()]);
  await roleManager.setUserRegistry(await userRegistry.getAddress());
  const productRegistry = await ethers.deployContract("ProductRegistry", [await roleManager.getAddress()]);
  const tracker = await ethers.deployContract("SupplyChainTracker", [
    await roleManager.getAddress(),
    await productRegistry.getAddress(),
  ]);
  await productRegistry.setTracker(await tracker.getAddress());
  const token = await ethers.deployContract("FarmChainTestToken", [admin.address, ethers.parseEther("1000000")]);
  const escrow = await ethers.deployContract("PaymentEscrow", [
    await token.getAddress(),
    await roleManager.getAddress(),
    await productRegistry.getAddress(),
  ]);

  return {
    admin, farmer, distributor, warehouse, retailer, outsider, farmer2, distributor2,
    roleManager, userRegistry, productRegistry, tracker, token, escrow,
  };
}

/** Contracts + four verified participants (one per role). */
export async function deployWithParticipants() {
  const ctx = await deployContracts();
  const { userRegistry, roleManager, farmer, distributor, warehouse, retailer } = ctx;
  const people: [typeof farmer, string, number][] = [
    [farmer, "Ravi Kumar", Role.Farmer],
    [distributor, "Kovai Logistics", Role.Distributor],
    [warehouse, "TN Cold Storage", Role.Warehouse],
    [retailer, "FreshMart Chennai", Role.Retailer],
  ];
  for (const [signer, name, role] of people) {
    await userRegistry.connect(signer).registerUser(name, `${name} Org`, "Coimbatore, Tamil Nadu", role);
    await roleManager.verifyParticipant(signer.address);
  }
  return ctx;
}

export async function batchInput(overrides: Partial<Record<string, unknown>> = {}) {
  const now = await time.latest();
  return {
    productName: "Organic Tomatoes",
    category: "Vegetables",
    quantity: 500n,
    unit: "kg",
    harvestDate: BigInt(now - 3600),
    farmLocation: "Coimbatore, Tamil Nadu, India",
    metadataCID: `bafkreitest${Math.random().toString(36).slice(2, 12)}`,
    ...overrides,
  };
}

/** Registers a batch as `farmer` and returns its ID. */
export async function registerBatch(ctx: Awaited<ReturnType<typeof deployWithParticipants>>, overrides = {}) {
  const id = await ctx.productRegistry.nextBatchId();
  await ctx.productRegistry.connect(ctx.farmer).registerBatch(id, await batchInput(overrides));
  return id;
}
