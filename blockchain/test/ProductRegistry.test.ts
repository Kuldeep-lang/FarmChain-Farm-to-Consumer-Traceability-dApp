import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { Action, FIRST_BATCH_ID, Stage, batchInput, deployContracts, deployWithParticipants, registerBatch } from "./fixtures";

describe("ProductRegistry", () => {
  it("registers a batch for a verified farmer with sequential unique ID", async () => {
    const ctx = await loadFixture(deployWithParticipants);
    const { productRegistry, tracker, farmer } = ctx;
    const input = await batchInput();
    expect(await productRegistry.nextBatchId()).to.equal(FIRST_BATCH_ID);

    await expect(productRegistry.connect(farmer).registerBatch(FIRST_BATCH_ID, input))
      .to.emit(productRegistry, "BatchRegistered")
      .withArgs(FIRST_BATCH_ID, farmer.address, input.productName, input.category, input.quantity, input.unit, input.metadataCID, (t: bigint) => t > 0n)
      .and.to.emit(tracker, "BatchStageUpdated");

    const b = await productRegistry.getBatch(FIRST_BATCH_ID);
    expect(b.id).to.equal(FIRST_BATCH_ID);
    expect(b.farmer).to.equal(farmer.address);
    expect(b.currentOwner).to.equal(farmer.address);
    expect(b.status).to.equal(Stage.REGISTERED);
    expect(b.quantity).to.equal(500n);
    expect(b.metadataCID).to.equal(input.metadataCID);
    expect(await productRegistry.getFarmerBatches(farmer.address)).to.deep.equal([FIRST_BATCH_ID]);
    expect(await productRegistry.getBatchOwner(FIRST_BATCH_ID)).to.equal(farmer.address);
    expect(await productRegistry.getBatchStatus(FIRST_BATCH_ID)).to.equal(Stage.REGISTERED);
    expect(await productRegistry.totalBatches()).to.equal(1n);
    expect(await productRegistry.nextBatchId()).to.equal(FIRST_BATCH_ID + 1n);

    const history = await tracker.getBatchHistory(FIRST_BATCH_ID);
    expect(history.length).to.equal(2);
    expect(history[0].action).to.equal(Action.Harvested);
    expect(history[0].timestamp).to.equal(input.harvestDate);
    expect(history[1].action).to.equal(Action.Registered);
    expect(history[1].stage).to.equal(Stage.REGISTERED);
  });

  it("prevents duplicate batches (stale expected ID and reused metadata)", async () => {
    const ctx = await loadFixture(deployWithParticipants);
    const { productRegistry, farmer } = ctx;
    const input = await batchInput();
    await productRegistry.connect(farmer).registerBatch(FIRST_BATCH_ID, input);
    // Same expected ID again -> mismatch (ID already taken)
    await expect(productRegistry.connect(farmer).registerBatch(FIRST_BATCH_ID, await batchInput()))
      .to.be.revertedWithCustomError(productRegistry, "BatchIdMismatch")
      .withArgs(FIRST_BATCH_ID, FIRST_BATCH_ID + 1n);
    // Correct ID but identical metadata document -> duplicate
    await expect(productRegistry.connect(farmer).registerBatch(FIRST_BATCH_ID + 1n, input))
      .to.be.revertedWithCustomError(productRegistry, "DuplicateMetadata");
    expect(await productRegistry.metadataUsed(ethers.keccak256(ethers.toUtf8Bytes(input.metadataCID)))).to.equal(true);
  });

  it("allows registration without IPFS metadata (empty CID is not deduplicated)", async () => {
    const ctx = await loadFixture(deployWithParticipants);
    const a = await registerBatch(ctx, { metadataCID: "" });
    const b = await registerBatch(ctx, { metadataCID: "" });
    expect(b).to.equal(a + 1n);
  });

  it("rejects batch registration by unregistered, unverified, revoked or non-farmer accounts", async () => {
    const ctx = await loadFixture(deployWithParticipants);
    const { productRegistry, roleManager, userRegistry, outsider, distributor, farmer, farmer2 } = ctx;
    await expect(productRegistry.connect(outsider).registerBatch(FIRST_BATCH_ID, await batchInput()))
      .to.be.revertedWithCustomError(productRegistry, "NotVerifiedFarmer");
    await expect(productRegistry.connect(distributor).registerBatch(FIRST_BATCH_ID, await batchInput()))
      .to.be.revertedWithCustomError(productRegistry, "NotVerifiedFarmer");
    await userRegistry.connect(farmer2).registerUser("Pending", "", "X", 1);
    await expect(productRegistry.connect(farmer2).registerBatch(FIRST_BATCH_ID, await batchInput()))
      .to.be.revertedWithCustomError(productRegistry, "NotVerifiedFarmer");
    await roleManager.revokeVerification(farmer.address, "test");
    await expect(productRegistry.connect(farmer).registerBatch(FIRST_BATCH_ID, await batchInput()))
      .to.be.revertedWithCustomError(productRegistry, "NotVerifiedFarmer");
  });

  it("validates batch input", async () => {
    const ctx = await loadFixture(deployWithParticipants);
    const { productRegistry, farmer } = ctx;
    const reg = async (o: Record<string, unknown>) => productRegistry.connect(farmer).registerBatch(FIRST_BATCH_ID, await batchInput(o));
    await expect(reg({ productName: "" })).to.be.revertedWithCustomError(productRegistry, "EmptyField");
    await expect(reg({ category: "" })).to.be.revertedWithCustomError(productRegistry, "EmptyField");
    await expect(reg({ unit: "" })).to.be.revertedWithCustomError(productRegistry, "EmptyField");
    await expect(reg({ farmLocation: "" })).to.be.revertedWithCustomError(productRegistry, "EmptyField");
    await expect(reg({ productName: "x".repeat(129) })).to.be.revertedWithCustomError(productRegistry, "FieldTooLong");
    await expect(reg({ category: "x".repeat(129) })).to.be.revertedWithCustomError(productRegistry, "FieldTooLong");
    await expect(reg({ unit: "x".repeat(33) })).to.be.revertedWithCustomError(productRegistry, "FieldTooLong");
    await expect(reg({ farmLocation: "x".repeat(129) })).to.be.revertedWithCustomError(productRegistry, "FieldTooLong");
    await expect(reg({ metadataCID: "x".repeat(129) })).to.be.revertedWithCustomError(productRegistry, "FieldTooLong");
    await expect(reg({ quantity: 0n })).to.be.revertedWithCustomError(productRegistry, "InvalidQuantity");
    await expect(reg({ harvestDate: 0n })).to.be.revertedWithCustomError(productRegistry, "InvalidHarvestDate");
    const future = BigInt((await time.latest()) + 3 * 86400);
    await expect(reg({ harvestDate: future })).to.be.revertedWithCustomError(productRegistry, "InvalidHarvestDate");
  });

  it("only the original farmer can update metadata, and only before the batch leaves the farm", async () => {
    const ctx = await loadFixture(deployWithParticipants);
    const { productRegistry, tracker, farmer, distributor, outsider } = ctx;
    const id = await registerBatch(ctx);
    await expect(productRegistry.connect(outsider).updateBatchMetadata(id, "bafyNew"))
      .to.be.revertedWithCustomError(productRegistry, "NotBatchFarmer");
    await expect(productRegistry.connect(farmer).updateBatchMetadata(id, ""))
      .to.be.revertedWithCustomError(productRegistry, "EmptyField");
    await expect(productRegistry.connect(farmer).updateBatchMetadata(id, "x".repeat(129)))
      .to.be.revertedWithCustomError(productRegistry, "FieldTooLong");
    const old = (await productRegistry.getBatch(id)).metadataCID;
    await expect(productRegistry.connect(farmer).updateBatchMetadata(id, old))
      .to.be.revertedWithCustomError(productRegistry, "DuplicateMetadata");

    await expect(productRegistry.connect(farmer).updateBatchMetadata(id, "bafyNewMetadata"))
      .to.emit(productRegistry, "BatchMetadataUpdated")
      .withArgs(id, farmer.address, old, "bafyNewMetadata", (t: bigint) => t > 0n);
    const history = await tracker.getBatchHistory(id);
    expect(history[history.length - 1].action).to.equal(Action.MetadataUpdated);

    // Pending transfer locks metadata
    await tracker.connect(farmer).initiateTransfer(id, distributor.address, "Farm gate", "");
    await expect(productRegistry.connect(farmer).updateBatchMetadata(id, "bafyAnother"))
      .to.be.revertedWithCustomError(productRegistry, "MetadataLocked");
    // After custody changes it stays locked
    await tracker.connect(distributor).acceptTransfer(id);
    await expect(productRegistry.connect(farmer).updateBatchMetadata(id, "bafyAnother"))
      .to.be.revertedWithCustomError(productRegistry, "MetadataLocked");
  });

  it("revoked farmer cannot update metadata", async () => {
    const ctx = await loadFixture(deployWithParticipants);
    const id = await registerBatch(ctx);
    await ctx.roleManager.revokeVerification(ctx.farmer.address, "x");
    await expect(ctx.productRegistry.connect(ctx.farmer).updateBatchMetadata(id, "bafyZ"))
      .to.be.revertedWithCustomError(ctx.productRegistry, "NotVerifiedFarmer");
  });

  it("nobody but the tracker can change owner or status", async () => {
    const ctx = await loadFixture(deployWithParticipants);
    const { productRegistry, admin, farmer, outsider } = ctx;
    const id = await registerBatch(ctx);
    await expect(productRegistry.connect(admin).setOwner(id, outsider.address)).to.be.revertedWithCustomError(productRegistry, "OnlyTracker");
    await expect(productRegistry.connect(farmer).setStatus(id, Stage.SOLD)).to.be.revertedWithCustomError(productRegistry, "OnlyTracker");
  });

  it("view functions revert for unknown batches", async () => {
    const { productRegistry } = await loadFixture(deployWithParticipants);
    await expect(productRegistry.getBatch(99)).to.be.revertedWithCustomError(productRegistry, "BatchNotFound");
    await expect(productRegistry.getBatchOwner(99)).to.be.revertedWithCustomError(productRegistry, "BatchNotFound");
    await expect(productRegistry.getBatchStatus(99)).to.be.revertedWithCustomError(productRegistry, "BatchNotFound");
    await expect(productRegistry.getBatchFarmer(99)).to.be.revertedWithCustomError(productRegistry, "BatchNotFound");
    expect(await productRegistry.batchExists(99)).to.equal(false);
  });

  it("admin configuration and pausing", async () => {
    const ctx = await loadFixture(deployWithParticipants);
    const { productRegistry, roleManager, farmer, outsider } = ctx;
    await expect(productRegistry.setTracker(outsider.address)).to.be.revertedWithCustomError(productRegistry, "TrackerAlreadySet");
    await expect(productRegistry.connect(outsider).pause()).to.be.revertedWithCustomError(productRegistry, "NotAdmin");
    await productRegistry.pause();
    await expect(productRegistry.connect(farmer).registerBatch(FIRST_BATCH_ID, await batchInput()))
      .to.be.revertedWithCustomError(productRegistry, "EnforcedPause");
    await expect(productRegistry.connect(outsider).unpause()).to.be.revertedWithCustomError(productRegistry, "NotAdmin");
    await productRegistry.unpause();
    await registerBatch(ctx);

    const fresh = await ethers.deployContract("ProductRegistry", [await roleManager.getAddress()]);
    await expect(fresh.connect(farmer).registerBatch(FIRST_BATCH_ID, await batchInput()))
      .to.be.revertedWithCustomError(fresh, "TrackerNotSet");
    await expect(fresh.setTracker(ethers.ZeroAddress)).to.be.revertedWithCustomError(fresh, "ZeroAddress");
    await expect(ethers.deployContract("ProductRegistry", [ethers.ZeroAddress])).to.be.revertedWithCustomError(fresh, "ZeroAddress");
  });

  it("tracker hooks can only be called by the registry", async () => {
    const { tracker, farmer } = await loadFixture(deployContracts);
    await expect(tracker.connect(farmer).onBatchRegistered(1, farmer.address, 1, "x", "y"))
      .to.be.revertedWithCustomError(tracker, "OnlyProductRegistry");
    await expect(tracker.connect(farmer).onMetadataUpdated(1, farmer.address, "y"))
      .to.be.revertedWithCustomError(tracker, "OnlyProductRegistry");
  });
});
