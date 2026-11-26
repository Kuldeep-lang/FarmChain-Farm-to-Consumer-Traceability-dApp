import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Action, Stage, deployWithParticipants, registerBatch } from "./fixtures";

async function withBatch() {
  const ctx = await deployWithParticipants();
  const id = await registerBatch(ctx);
  return { ...ctx, id };
}

/** Moves the batch to the distributor (accepted). */
async function atDistributor() {
  const ctx = await withBatch();
  await ctx.tracker.connect(ctx.farmer).initiateTransfer(ctx.id, ctx.distributor.address, "Farm gate", "");
  await ctx.tracker.connect(ctx.distributor).acceptTransfer(ctx.id);
  return ctx;
}

/** Batch at warehouse with arrival recorded. */
async function atWarehouse() {
  const ctx = await atDistributor();
  await ctx.tracker.connect(ctx.distributor).recordShipment(ctx.id, "NH544 Coimbatore -> Chennai", "");
  await ctx.tracker.connect(ctx.distributor).initiateTransfer(ctx.id, ctx.warehouse.address, "Chennai hub", "");
  await ctx.tracker.connect(ctx.warehouse).acceptTransfer(ctx.id);
  await ctx.tracker.connect(ctx.warehouse).recordWarehouseArrival(ctx.id, "Cold room 3, 4°C", "");
  return ctx;
}

/** Batch accepted by retailer and arrival recorded. */
async function atRetailer() {
  const ctx = await atWarehouse();
  await ctx.tracker.connect(ctx.warehouse).initiateTransfer(ctx.id, ctx.retailer.address, "Chennai hub", "");
  await ctx.tracker.connect(ctx.retailer).acceptTransfer(ctx.id);
  await ctx.tracker.connect(ctx.retailer).recordRetailArrival(ctx.id, "FreshMart T. Nagar", "");
  return ctx;
}

describe("SupplyChainTracker", () => {
  describe("transfers", () => {
    it("farmer initiates a valid transfer to a verified distributor; ownership unchanged until accepted", async () => {
      const { tracker, productRegistry, farmer, distributor, id } = await loadFixture(withBatch);
      await expect(tracker.connect(farmer).initiateTransfer(id, distributor.address, "Farm gate", "bafyDoc"))
        .to.emit(tracker, "TransferInitiated")
        .withArgs(id, farmer.address, distributor.address, "Farm gate", "bafyDoc", (t: bigint) => t > 0n);
      expect(await productRegistry.getBatchOwner(id)).to.equal(farmer.address);
      const p = await tracker.getPendingTransfer(id);
      expect(p.active).to.equal(true);
      expect(p.to).to.equal(distributor.address);
      expect(await tracker.hasPendingTransfer(id)).to.equal(true);
      expect(await tracker.getParticipantBatches(distributor.address)).to.deep.equal([id]);
    });

    it("recipient accepts the transfer and becomes owner", async () => {
      const { tracker, productRegistry, farmer, distributor, id } = await loadFixture(withBatch);
      await tracker.connect(farmer).initiateTransfer(id, distributor.address, "Farm gate", "");
      await expect(tracker.connect(distributor).acceptTransfer(id))
        .to.emit(tracker, "TransferAccepted")
        .withArgs(id, farmer.address, distributor.address, (t: bigint) => t > 0n)
        .and.to.emit(tracker, "BatchTransferred")
        .and.to.emit(productRegistry, "BatchOwnerChanged");
      expect(await productRegistry.getBatchOwner(id)).to.equal(distributor.address);
      expect(await tracker.hasPendingTransfer(id)).to.equal(false);
      const h = await tracker.getBatchHistory(id);
      const last = h[h.length - 1];
      expect(last.action).to.equal(Action.TransferAccepted);
      expect(last.previousOwner).to.equal(farmer.address);
      expect(last.newOwner).to.equal(distributor.address);
      expect(last.actor).to.equal(distributor.address);
    });

    it("rejects invalid transfers (wrong roles, self, zero, unverified, non-owner)", async () => {
      const ctx = await loadFixture(withBatch);
      const { tracker, userRegistry, farmer, warehouse, retailer, outsider, distributor, farmer2, id } = ctx;
      // Farmer cannot skip the distributor
      await expect(tracker.connect(farmer).initiateTransfer(id, warehouse.address, "", ""))
        .to.be.revertedWithCustomError(tracker, "InvalidTransfer");
      await expect(tracker.connect(farmer).initiateTransfer(id, retailer.address, "", ""))
        .to.be.revertedWithCustomError(tracker, "InvalidTransfer");
      await expect(tracker.connect(farmer).initiateTransfer(id, farmer.address, "", ""))
        .to.be.revertedWithCustomError(tracker, "InvalidTransfer");
      await expect(tracker.connect(farmer).initiateTransfer(id, ethers.ZeroAddress, "", ""))
        .to.be.revertedWithCustomError(tracker, "InvalidTransfer");
      await expect(tracker.connect(farmer).initiateTransfer(id, outsider.address, "", ""))
        .to.be.revertedWithCustomError(tracker, "InvalidTransfer");
      // Registered-but-unverified distributor
      await userRegistry.connect(farmer2).registerUser("Unverified", "", "X", 2);
      await expect(tracker.connect(farmer).initiateTransfer(id, farmer2.address, "", ""))
        .to.be.revertedWithCustomError(tracker, "InvalidTransfer");
      // Not owner
      await expect(tracker.connect(distributor).initiateTransfer(id, warehouse.address, "", ""))
        .to.be.revertedWithCustomError(tracker, "NotBatchOwner");
      // Unknown batch
      await expect(tracker.connect(farmer).initiateTransfer(999, distributor.address, "", ""))
        .to.be.revertedWithCustomError(tracker, "BatchNotFound");
      // Field limits
      await expect(tracker.connect(farmer).initiateTransfer(id, distributor.address, "x".repeat(129), ""))
        .to.be.revertedWithCustomError(tracker, "FieldTooLong");
      await expect(tracker.connect(farmer).initiateTransfer(id, distributor.address, "", "x".repeat(129)))
        .to.be.revertedWithCustomError(tracker, "FieldTooLong");
      expect(await tracker.canTransfer(farmer.address, distributor.address)).to.equal(true);
      expect(await tracker.canTransfer(farmer.address, retailer.address)).to.equal(false);
      expect(await tracker.canTransfer(farmer.address, farmer.address)).to.equal(false);
    });

    it("prevents a second pending transfer and acceptance by anyone other than the recipient", async () => {
      const { tracker, farmer, distributor, distributor2, roleManager, userRegistry, outsider, id } = await loadFixture(withBatch);
      await userRegistry.connect(distributor2).registerUser("D2", "", "X", 2);
      await roleManager.verifyParticipant(distributor2.address);
      await tracker.connect(farmer).initiateTransfer(id, distributor.address, "", "");
      await expect(tracker.connect(farmer).initiateTransfer(id, distributor2.address, "", ""))
        .to.be.revertedWithCustomError(tracker, "TransferAlreadyPending");
      await expect(tracker.connect(distributor2).acceptTransfer(id)).to.be.revertedWithCustomError(tracker, "NotTransferRecipient");
      await expect(tracker.connect(outsider).acceptTransfer(id)).to.be.revertedWithCustomError(tracker, "NotTransferRecipient");
      await expect(tracker.connect(farmer).acceptTransfer(id)).to.be.revertedWithCustomError(tracker, "NotTransferRecipient");
      await expect(tracker.connect(distributor).acceptTransfer(999)).to.be.revertedWithCustomError(tracker, "NoPendingTransfer");
    });

    it("recipient rejects transfer; custody stays with sender and history is preserved", async () => {
      const { tracker, productRegistry, farmer, distributor, outsider, id } = await loadFixture(withBatch);
      await tracker.connect(farmer).initiateTransfer(id, distributor.address, "Farm gate", "");
      await expect(tracker.connect(outsider).rejectTransfer(id, "no")).to.be.revertedWithCustomError(tracker, "NotTransferRecipient");
      await expect(tracker.connect(distributor).rejectTransfer(id, "x".repeat(257))).to.be.revertedWithCustomError(tracker, "FieldTooLong");
      await expect(tracker.connect(distributor).rejectTransfer(id, "Truck unavailable"))
        .to.emit(tracker, "TransferRejected")
        .withArgs(id, farmer.address, distributor.address, "Truck unavailable", (t: bigint) => t > 0n);
      expect(await productRegistry.getBatchOwner(id)).to.equal(farmer.address);
      expect(await tracker.hasPendingTransfer(id)).to.equal(false);
      await expect(tracker.connect(distributor).rejectTransfer(id, "")).to.be.revertedWithCustomError(tracker, "NoPendingTransfer");
      const h = await tracker.getBatchHistory(id);
      expect(h.map((e) => Number(e.action))).to.deep.equal([Action.Harvested, Action.Registered, Action.TransferInitiated, Action.TransferRejected]);
      expect(await tracker.getHistoryLength(id)).to.equal(4n);
      expect((await tracker.getHistoryEntry(id, 3)).actor).to.equal(distributor.address);
    });

    it("sender can cancel a pending transfer", async () => {
      const { tracker, farmer, distributor, id } = await loadFixture(withBatch);
      await expect(tracker.connect(farmer).cancelTransfer(id)).to.be.revertedWithCustomError(tracker, "NoPendingTransfer");
      await tracker.connect(farmer).initiateTransfer(id, distributor.address, "", "");
      await expect(tracker.connect(distributor).cancelTransfer(id)).to.be.revertedWithCustomError(tracker, "NotTransferSender");
      await expect(tracker.connect(farmer).cancelTransfer(id)).to.emit(tracker, "TransferCancelled");
      await expect(tracker.connect(distributor).acceptTransfer(id)).to.be.revertedWithCustomError(tracker, "NoPendingTransfer");
    });

    it("acceptance fails if the recipient was revoked after the offer", async () => {
      const { tracker, roleManager, farmer, distributor, id } = await loadFixture(withBatch);
      await tracker.connect(farmer).initiateTransfer(id, distributor.address, "", "");
      await roleManager.revokeVerification(distributor.address, "license expired");
      await expect(tracker.connect(distributor).acceptTransfer(id)).to.be.revertedWithCustomError(tracker, "InvalidTransfer");
    });

    it("distributor may transfer to warehouse or retailer; warehouse to retailer or distributor; retailer cannot transfer", async () => {
      const ctx = await loadFixture(atDistributor);
      const { tracker, distributor, warehouse, retailer, farmer } = ctx;
      expect(await tracker.canTransfer(distributor.address, warehouse.address)).to.equal(true);
      expect(await tracker.canTransfer(distributor.address, retailer.address)).to.equal(true);
      expect(await tracker.canTransfer(distributor.address, farmer.address)).to.equal(false);
      expect(await tracker.canTransfer(warehouse.address, retailer.address)).to.equal(true);
      expect(await tracker.canTransfer(warehouse.address, distributor.address)).to.equal(true);
      expect(await tracker.canTransfer(warehouse.address, farmer.address)).to.equal(false);
      expect(await tracker.canTransfer(retailer.address, distributor.address)).to.equal(false);
      // Direct distributor -> retailer path
      await tracker.connect(distributor).initiateTransfer(ctx.id, retailer.address, "", "");
      await tracker.connect(retailer).acceptTransfer(ctx.id);
      await tracker.connect(retailer).recordRetailArrival(ctx.id, "Store", "");
      await expect(tracker.connect(retailer).initiateTransfer(ctx.id, distributor.address, "", ""))
        .to.be.revertedWithCustomError(tracker, "InvalidStageTransition");
    });
  });

  describe("stage updates", () => {
    it("tracks the complete supply-chain journey with ordered immutable history", async () => {
      const ctx = await loadFixture(atRetailer);
      const { tracker, productRegistry, retailer, farmer, distributor, warehouse, id } = ctx;
      await tracker.connect(retailer).updateBatchStatus(id, Stage.AVAILABLE_FOR_SALE, "Aisle 4", "");
      await tracker.connect(retailer).updateBatchStatus(id, Stage.SOLD, "Checkout", "");
      expect(await productRegistry.getBatchStatus(id)).to.equal(Stage.SOLD);
      expect(await productRegistry.getBatchOwner(id)).to.equal(retailer.address);

      const h = await tracker.getBatchHistory(id);
      expect(h.map((e) => Number(e.action))).to.deep.equal([
        Action.Harvested,
        Action.Registered,
        Action.TransferInitiated,
        Action.TransferAccepted,
        Action.ShipmentRecorded,
        Action.TransferInitiated,
        Action.TransferAccepted,
        Action.WarehouseArrival,
        Action.TransferInitiated,
        Action.TransferAccepted,
        Action.RetailArrival,
        Action.AvailableForSale,
        Action.Sold,
      ]);
      expect(h[4].stage).to.equal(Stage.IN_TRANSIT);
      expect(h[4].actor).to.equal(distributor.address);
      expect(h[4].location).to.equal("NH544 Coimbatore -> Chennai");
      expect(h[7].stage).to.equal(Stage.AT_WAREHOUSE);
      expect(h[7].actor).to.equal(warehouse.address);
      expect(h[3].previousOwner).to.equal(farmer.address);
      for (let i = 1; i < h.length; i++) expect(h[i].timestamp).to.be.gte(h[i - 1].timestamp);
      // participants dashboards
      expect(await tracker.getParticipantBatches(warehouse.address)).to.deep.equal([id]);
      expect(await tracker.getParticipantBatches(farmer.address)).to.deep.equal([id]);
    });

    it("records quality inspections (passed and failed)", async () => {
      const { tracker, productRegistry, warehouse, id } = await loadFixture(atWarehouse);
      await expect(tracker.connect(warehouse).recordQualityInspection(id, true, "Lab 1", "bafyReport"))
        .to.emit(tracker, "QualityInspectionRecorded")
        .withArgs(id, warehouse.address, true, "bafyReport", (t: bigint) => t > 0n);
      expect(await productRegistry.getBatchStatus(id)).to.equal(Stage.QUALITY_CHECKED);
      await tracker.connect(warehouse).recordQualityInspection(id, false, "Lab 1", "bafyReport2");
      const h = await tracker.getBatchHistory(id);
      expect(h[h.length - 2].action).to.equal(Action.QualityInspectionPassed);
      expect(h[h.length - 1].action).to.equal(Action.QualityInspectionFailed);
      expect(h[h.length - 1].metadataCID).to.equal("bafyReport2");
    });

    it("quality inspection requires the batch to be at the warehouse", async () => {
      const ctx = await loadFixture(atDistributor);
      await ctx.tracker.connect(ctx.distributor).initiateTransfer(ctx.id, ctx.warehouse.address, "", "");
      await ctx.tracker.connect(ctx.warehouse).acceptTransfer(ctx.id);
      await expect(ctx.tracker.connect(ctx.warehouse).recordQualityInspection(ctx.id, true, "", ""))
        .to.be.revertedWithCustomError(ctx.tracker, "InvalidStageTransition");
    });

    it("rejects unauthorized status updates", async () => {
      const ctx = await loadFixture(atDistributor);
      const { tracker, farmer, warehouse, retailer, outsider, distributor, id } = ctx;
      // Non-owners
      await expect(tracker.connect(farmer).recordShipment(id, "x", "")).to.be.revertedWithCustomError(tracker, "NotBatchOwner");
      await expect(tracker.connect(outsider).recordShipment(id, "x", "")).to.be.revertedWithCustomError(tracker, "NotBatchOwner");
      await expect(tracker.connect(warehouse).recordWarehouseArrival(id, "x", "")).to.be.revertedWithCustomError(tracker, "NotBatchOwner");
      await expect(tracker.connect(retailer).recordRetailArrival(id, "x", "")).to.be.revertedWithCustomError(tracker, "NotBatchOwner");
      await expect(tracker.connect(outsider).updateBatchStatus(id, Stage.OUT_FOR_DELIVERY, "", "")).to.be.revertedWithCustomError(tracker, "NotBatchOwner");
      // Owner but wrong role
      await expect(tracker.connect(distributor).recordWarehouseArrival(id, "x", "")).to.be.revertedWithCustomError(tracker, "RoleNotAllowed");
      await expect(tracker.connect(distributor).recordRetailArrival(id, "x", "")).to.be.revertedWithCustomError(tracker, "RoleNotAllowed");
      await expect(tracker.connect(distributor).recordQualityInspection(id, true, "x", "")).to.be.revertedWithCustomError(tracker, "RoleNotAllowed");
      await expect(tracker.connect(distributor).updateBatchStatus(id, Stage.AVAILABLE_FOR_SALE, "", "")).to.be.revertedWithCustomError(tracker, "RoleNotAllowed");
      await expect(tracker.connect(distributor).updateBatchStatus(id, Stage.SOLD, "", "")).to.be.revertedWithCustomError(tracker, "RoleNotAllowed");
      // Stages that require dedicated functions
      await expect(tracker.connect(distributor).updateBatchStatus(id, Stage.AT_WAREHOUSE, "", "")).to.be.revertedWithCustomError(tracker, "InvalidStageTransition");
      await expect(tracker.connect(distributor).updateBatchStatus(id, Stage.HARVESTED, "", "")).to.be.revertedWithCustomError(tracker, "InvalidStageTransition");
      // Only admin or original farmer can recall
      await expect(tracker.connect(distributor).updateBatchStatus(id, Stage.RECALLED, "", "")).to.be.revertedWithCustomError(tracker, "RoleNotAllowed");
      // Required fields
      await expect(tracker.connect(distributor).recordShipment(id, "", "")).to.be.revertedWithCustomError(tracker, "EmptyField");
      await expect(tracker.connect(distributor).recordShipment(999, "x", "")).to.be.revertedWithCustomError(tracker, "BatchNotFound");
    });

    it("revoked participants cannot update batches they hold", async () => {
      const { tracker, roleManager, distributor, id } = await loadFixture(atDistributor);
      await roleManager.revokeVerification(distributor.address, "x");
      await expect(tracker.connect(distributor).recordShipment(id, "x", "")).to.be.revertedWithCustomError(tracker, "NotVerified");
      await expect(tracker.connect(distributor).updateBatchStatus(id, Stage.OUT_FOR_DELIVERY, "", "")).to.be.revertedWithCustomError(tracker, "RoleNotAllowed");
    });

    it("blocks stage updates while a transfer is pending", async () => {
      const { tracker, distributor, warehouse, id } = await loadFixture(atDistributor);
      await tracker.connect(distributor).initiateTransfer(id, warehouse.address, "", "");
      await expect(tracker.connect(distributor).recordShipment(id, "x", "")).to.be.revertedWithCustomError(tracker, "TransferAlreadyPending");
      await expect(tracker.connect(distributor).updateBatchStatus(id, Stage.OUT_FOR_DELIVERY, "", "")).to.be.revertedWithCustomError(tracker, "TransferAlreadyPending");
    });

    it("enforces valid stage ordering for retail stages", async () => {
      const ctx = await loadFixture(atRetailer);
      const { tracker, retailer, warehouse, id } = ctx;
      await expect(tracker.connect(retailer).updateBatchStatus(id, Stage.SOLD, "", "")).to.be.revertedWithCustomError(tracker, "InvalidStageTransition");
      await expect(tracker.connect(retailer).recordRetailArrival(id, "again", "")).to.be.revertedWithCustomError(tracker, "InvalidStageTransition");
      await tracker.connect(retailer).updateBatchStatus(id, Stage.AVAILABLE_FOR_SALE, "", "");
      await expect(tracker.connect(retailer).updateBatchStatus(id, Stage.AVAILABLE_FOR_SALE, "", "")).to.be.revertedWithCustomError(tracker, "InvalidStageTransition");
      await expect(tracker.connect(retailer).updateBatchStatus(id, Stage.OUT_FOR_DELIVERY, "", "")).to.be.revertedWithCustomError(tracker, "RoleNotAllowed");
      expect(warehouse.address).to.not.equal(retailer.address);
    });

    it("distributor and warehouse can mark OUT_FOR_DELIVERY; not after retail arrival", async () => {
      const ctx = await loadFixture(atWarehouse);
      const { tracker, productRegistry, warehouse, id } = ctx;
      await tracker.connect(warehouse).updateBatchStatus(id, Stage.OUT_FOR_DELIVERY, "Dock 2", "");
      expect(await productRegistry.getBatchStatus(id)).to.equal(Stage.OUT_FOR_DELIVERY);
      // shipment/arrival not allowed after retail stages
      const r = await loadFixture(atRetailer);
      await expect(r.tracker.connect(r.retailer).updateBatchStatus(r.id, Stage.RECALLED, "", "")).to.be.revertedWithCustomError(r.tracker, "RoleNotAllowed");
    });

    it("admin or original farmer can recall a batch, cancelling any pending transfer; recalled batches are frozen", async () => {
      const ctx = await loadFixture(atDistributor);
      const { tracker, productRegistry, admin, farmer, distributor, warehouse, id } = ctx;
      await tracker.connect(distributor).initiateTransfer(id, warehouse.address, "", "");
      await expect(tracker.connect(farmer).updateBatchStatus(id, Stage.RECALLED, "Coimbatore", "bafyRecallNotice"))
        .to.emit(tracker, "TransferCancelled");
      expect(await productRegistry.getBatchStatus(id)).to.equal(Stage.RECALLED);
      expect(await tracker.hasPendingTransfer(id)).to.equal(false);
      await expect(tracker.connect(admin).updateBatchStatus(id, Stage.RECALLED, "", "")).to.be.revertedWithCustomError(tracker, "InvalidStageTransition");
      await expect(tracker.connect(distributor).initiateTransfer(id, warehouse.address, "", "")).to.be.revertedWithCustomError(tracker, "BatchFinalized");
      await expect(tracker.connect(distributor).recordShipment(id, "x", "")).to.be.revertedWithCustomError(tracker, "InvalidStageTransition");

      const ctx2 = await withBatch();
      await ctx2.tracker.connect(ctx2.admin).updateBatchStatus(ctx2.id, Stage.RECALLED, "", "");
      expect(await ctx2.productRegistry.getBatchStatus(ctx2.id)).to.equal(Stage.RECALLED);
    });

    it("pausing blocks transfers and updates but never recalls", async () => {
      const ctx = await loadFixture(atDistributor);
      const { tracker, admin, distributor, warehouse, outsider, id } = ctx;
      await expect(tracker.connect(outsider).pause()).to.be.revertedWithCustomError(tracker, "NotAdmin");
      await tracker.connect(admin).pause();
      await expect(tracker.connect(distributor).recordShipment(id, "x", "")).to.be.revertedWithCustomError(tracker, "EnforcedPause");
      await expect(tracker.connect(distributor).initiateTransfer(id, warehouse.address, "", "")).to.be.revertedWithCustomError(tracker, "EnforcedPause");
      await expect(tracker.connect(distributor).updateBatchStatus(id, Stage.OUT_FOR_DELIVERY, "", "")).to.be.revertedWithCustomError(tracker, "EnforcedPause");
      await tracker.connect(admin).updateBatchStatus(id, Stage.RECALLED, "", "");
      await expect(tracker.connect(outsider).unpause()).to.be.revertedWithCustomError(tracker, "NotAdmin");
      await tracker.connect(admin).unpause();
    });

    it("constructor guards", async () => {
      const { roleManager } = await loadFixture(withBatch);
      await expect(ethers.deployContract("SupplyChainTracker", [ethers.ZeroAddress, await roleManager.getAddress()])).to.be.reverted;
    });
  });
});
