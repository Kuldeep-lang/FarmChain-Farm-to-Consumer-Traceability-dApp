import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { Action, FIRST_BATCH_ID, OrderStatus, Role, Stage, deployContracts } from "./fixtures";

/**
 * Spec section 19: a farmer in Coimbatore sells 500 kg of tomatoes, through distributor,
 * warehouse and retailer, with escrow payment. Every step uses the real contracts.
 */
describe("End-to-end demonstration scenario", () => {
  it("runs the full farm-to-fork journey with escrow payment", async () => {
    const { admin, farmer, distributor, warehouse, retailer, roleManager, userRegistry, productRegistry, tracker, token, escrow } =
      await deployContracts();

    // STEP 1-2: registration + admin verification
    await userRegistry.connect(farmer).registerUser("Ravi Kumar", "Green Valley Farms", "Coimbatore, Tamil Nadu", Role.Farmer);
    await userRegistry.connect(distributor).registerUser("Arun", "Kovai Logistics", "Coimbatore, Tamil Nadu", Role.Distributor);
    await userRegistry.connect(warehouse).registerUser("Meena", "TN Cold Storage", "Chennai, Tamil Nadu", Role.Warehouse);
    await userRegistry.connect(retailer).registerUser("Priya", "FreshMart", "Chennai, Tamil Nadu", Role.Retailer);
    for (const s of [farmer, distributor, warehouse, retailer]) await roleManager.connect(admin).verifyParticipant(s.address);

    // STEP 3-6: batch registration with IPFS metadata CID
    const expectedId = await productRegistry.nextBatchId();
    expect(expectedId).to.equal(FIRST_BATCH_ID);
    const now = BigInt(await time.latest());
    const tx = await productRegistry.connect(farmer).registerBatch(expectedId, {
      productName: "Organic Tomatoes",
      category: "Vegetables",
      quantity: 500n,
      unit: "kg",
      harvestDate: now,
      farmLocation: "Coimbatore, Tamil Nadu, India",
      metadataCID: "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
    });
    const receipt = await tx.wait();
    const log = receipt!.logs.map((l) => { try { return productRegistry.interface.parseLog(l); } catch { return null; } })
      .find((l) => l?.name === "BatchRegistered");
    const batchId = log!.args.batchId as bigint;
    expect(batchId).to.equal(expectedId);

    // Distributor orders the batch and funds escrow
    const price = ethers.parseEther("2500");
    await token.connect(admin).transfer(distributor.address, price);
    await token.connect(distributor).approve(await escrow.getAddress(), price);
    await escrow.connect(distributor).createOrder(batchId, farmer.address, price, 7 * 86400);
    await escrow.connect(distributor).depositPayment(1);

    // STEP 8-10
    await tracker.connect(farmer).initiateTransfer(batchId, distributor.address, "Green Valley Farms gate", "");
    await tracker.connect(distributor).acceptTransfer(batchId);
    await escrow.connect(farmer).releasePayment(1); // custody proven on-chain
    expect(await token.balanceOf(farmer.address)).to.equal(price);
    expect((await escrow.getOrderDetails(1)).status).to.equal(OrderStatus.Released);
    await tracker.connect(distributor).recordShipment(batchId, "NH544, Coimbatore -> Chennai (TN-37-AB-1234)", "");

    // STEP 11-12
    await tracker.connect(distributor).initiateTransfer(batchId, warehouse.address, "Chennai Cold Hub", "");
    await tracker.connect(warehouse).acceptTransfer(batchId);
    await tracker.connect(warehouse).recordWarehouseArrival(batchId, "Chennai Cold Hub - Room 3 (4°C, 90% RH)", "");
    await tracker.connect(warehouse).recordQualityInspection(batchId, true, "Chennai Cold Hub QA Lab", "bafkreiinspectionreport");
    await tracker.connect(warehouse).initiateTransfer(batchId, retailer.address, "Chennai Cold Hub", "");

    // STEP 13
    await tracker.connect(retailer).acceptTransfer(batchId);
    await tracker.connect(retailer).recordRetailArrival(batchId, "FreshMart, T. Nagar, Chennai", "");
    await tracker.connect(retailer).updateBatchStatus(batchId, Stage.AVAILABLE_FOR_SALE, "FreshMart, T. Nagar, Chennai", "");

    // STEP 14-15: consumer reads the full verified journey (read-only, no wallet needed)
    const reader = tracker.connect(ethers.provider);
    const history = await reader.getBatchHistory(batchId);
    expect(history.map((h) => Number(h.action))).to.deep.equal([
      Action.Harvested, Action.Registered,
      Action.TransferInitiated, Action.TransferAccepted, Action.ShipmentRecorded,
      Action.TransferInitiated, Action.TransferAccepted, Action.WarehouseArrival, Action.QualityInspectionPassed,
      Action.TransferInitiated, Action.TransferAccepted, Action.RetailArrival, Action.AvailableForSale,
    ]);
    const batch = await productRegistry.connect(ethers.provider).getBatch(batchId);
    expect(batch.status).to.equal(Stage.AVAILABLE_FOR_SALE);
    expect(batch.currentOwner).to.equal(retailer.address);

    // STEP 16: every history entry maps to a transaction hash via HistoryRecorded logs
    const logs = await tracker.queryFilter(tracker.filters.HistoryRecorded(batchId));
    expect(logs.length).to.equal(history.length);
    for (const l of logs) expect(l.transactionHash).to.match(/^0x[0-9a-f]{64}$/);
  });
});
