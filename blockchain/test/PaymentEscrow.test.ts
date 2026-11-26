import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { OrderStatus, Stage, deployWithParticipants, registerBatch } from "./fixtures";

const AMOUNT = ethers.parseEther("1500");
const WINDOW = 3n * 24n * 3600n; // 3 days

async function escrowFixture() {
  const ctx = await deployWithParticipants();
  const id = await registerBatch(ctx);
  const { token, admin, distributor, escrow } = ctx;
  await token.connect(admin).transfer(distributor.address, ethers.parseEther("10000"));
  await token.connect(distributor).approve(await escrow.getAddress(), ethers.MaxUint256);
  return { ...ctx, id };
}

/** distributor (buyer) has created and funded order #1 with farmer (seller). */
async function fundedFixture() {
  const ctx = await escrowFixture();
  await ctx.escrow.connect(ctx.distributor).createOrder(ctx.id, ctx.farmer.address, AMOUNT, WINDOW);
  await ctx.escrow.connect(ctx.distributor).depositPayment(1);
  return ctx;
}

describe("PaymentEscrow", () => {
  it("buyer creates an order for a batch owned by the seller", async () => {
    const { escrow, distributor, farmer, id } = await loadFixture(escrowFixture);
    await expect(escrow.connect(distributor).createOrder(id, farmer.address, AMOUNT, WINDOW))
      .to.emit(escrow, "OrderCreated")
      .withArgs(1n, id, distributor.address, farmer.address, AMOUNT, WINDOW, (t: bigint) => t > 0n);
    const o = await escrow.getOrderDetails(1);
    expect(o.status).to.equal(OrderStatus.Created);
    expect(o.buyer).to.equal(distributor.address);
    expect(o.seller).to.equal(farmer.address);
    expect(o.batchId).to.equal(id);
    expect(o.amount).to.equal(AMOUNT);
    expect(o.createdAt).to.be.gt(0n);
    expect(await escrow.activeOrderForBatch(id)).to.equal(1n);
    expect(await escrow.getUserOrders(farmer.address)).to.deep.equal([1n]);
    expect(await escrow.getBatchOrders(id)).to.deep.equal([1n]);
    expect(await escrow.totalOrders()).to.equal(1n);
  });

  it("validates order creation", async () => {
    const { escrow, distributor, farmer, warehouse, outsider, id } = await loadFixture(escrowFixture);
    await expect(escrow.connect(outsider).createOrder(id, farmer.address, AMOUNT, WINDOW)).to.be.revertedWithCustomError(escrow, "NotVerified");
    await expect(escrow.connect(distributor).createOrder(id, outsider.address, AMOUNT, WINDOW)).to.be.revertedWithCustomError(escrow, "NotVerified");
    await expect(escrow.connect(distributor).createOrder(id, distributor.address, AMOUNT, WINDOW)).to.be.revertedWithCustomError(escrow, "InvalidSeller");
    await expect(escrow.connect(distributor).createOrder(id, warehouse.address, AMOUNT, WINDOW)).to.be.revertedWithCustomError(escrow, "InvalidSeller");
    await expect(escrow.connect(distributor).createOrder(id, farmer.address, 0, WINDOW)).to.be.revertedWithCustomError(escrow, "InvalidAmount");
    await expect(escrow.connect(distributor).createOrder(id, farmer.address, AMOUNT, 60)).to.be.revertedWithCustomError(escrow, "InvalidDeliveryWindow");
    await expect(escrow.connect(distributor).createOrder(id, farmer.address, AMOUNT, 181n * 86400n)).to.be.revertedWithCustomError(escrow, "InvalidDeliveryWindow");
    await expect(escrow.connect(distributor).createOrder(999, farmer.address, AMOUNT, WINDOW)).to.be.revertedWithCustomError(escrow, "BatchNotFound");
    await escrow.connect(distributor).createOrder(id, farmer.address, AMOUNT, WINDOW);
    await expect(escrow.connect(distributor).createOrder(id, farmer.address, AMOUNT, WINDOW)).to.be.revertedWithCustomError(escrow, "ActiveOrderExists");
    await expect(escrow.getOrderDetails(42)).to.be.revertedWithCustomError(escrow, "OrderNotFound");
  });

  it("cannot buy a recalled batch", async () => {
    const ctx = await loadFixture(escrowFixture);
    await ctx.tracker.connect(ctx.admin).updateBatchStatus(ctx.id, Stage.RECALLED, "", "");
    await expect(ctx.escrow.connect(ctx.distributor).createOrder(ctx.id, ctx.farmer.address, AMOUNT, WINDOW))
      .to.be.revertedWithCustomError(ctx.escrow, "BatchNotPurchasable");
  });

  it("buyer deposits payment into escrow", async () => {
    const { escrow, token, distributor, farmer, id } = await loadFixture(escrowFixture);
    await escrow.connect(distributor).createOrder(id, farmer.address, AMOUNT, WINDOW);
    await expect(escrow.connect(farmer).depositPayment(1)).to.be.revertedWithCustomError(escrow, "NotBuyer");
    const tx = await escrow.connect(distributor).depositPayment(1);
    await expect(tx).to.emit(escrow, "PaymentDeposited");
    await expect(tx).to.changeTokenBalances(token, [distributor, escrow], [-AMOUNT, AMOUNT]);
    const o = await escrow.getOrderDetails(1);
    expect(o.status).to.equal(OrderStatus.Funded);
    expect(o.deliveryDeadline).to.equal(o.fundedAt + WINDOW);
  });

  it("prevents double payment", async () => {
    const { escrow, distributor } = await loadFixture(fundedFixture);
    await expect(escrow.connect(distributor).depositPayment(1))
      .to.be.revertedWithCustomError(escrow, "InvalidOrderStatus")
      .withArgs(OrderStatus.Funded);
  });

  it("deposit fails without allowance and leaves the order unfunded", async () => {
    const { escrow, token, distributor, farmer, id } = await loadFixture(escrowFixture);
    await token.connect(distributor).approve(await escrow.getAddress(), 0);
    await escrow.connect(distributor).createOrder(id, farmer.address, AMOUNT, WINDOW);
    await expect(escrow.connect(distributor).depositPayment(1)).to.be.reverted;
    expect((await escrow.getOrderDetails(1)).status).to.equal(OrderStatus.Created);
  });

  it("buyer confirms delivery and funds are released to seller", async () => {
    const { escrow, token, distributor, farmer, id } = await loadFixture(fundedFixture);
    await expect(escrow.connect(farmer).confirmDelivery(1)).to.be.revertedWithCustomError(escrow, "NotBuyer");
    const tx = await escrow.connect(distributor).confirmDelivery(1);
    await expect(tx).to.emit(escrow, "DeliveryConfirmed");
    await expect(tx).to.emit(escrow, "PaymentReleased").withArgs(1n, id, farmer.address, AMOUNT, (t: bigint) => t > 0n);
    await expect(tx).to.changeTokenBalances(token, [escrow, farmer], [-AMOUNT, AMOUNT]);
    const o = await escrow.getOrderDetails(1);
    expect(o.status).to.equal(OrderStatus.Released);
    expect(o.deliveryConfirmed).to.equal(true);
    expect(await escrow.activeOrderForBatch(id)).to.equal(0n);
    // No double release
    await expect(escrow.connect(distributor).confirmDelivery(1)).to.be.revertedWithCustomError(escrow, "InvalidOrderStatus");
    await expect(escrow.connect(farmer).releasePayment(1)).to.be.revertedWithCustomError(escrow, "InvalidOrderStatus");
    await expect(escrow.connect(farmer).requestRefund(1)).to.be.revertedWithCustomError(escrow, "InvalidOrderStatus");
  });

  it("seller releases payment once custody is accepted on-chain", async () => {
    const { escrow, tracker, token, distributor, farmer, outsider, id } = await loadFixture(fundedFixture);
    await expect(escrow.connect(farmer).releasePayment(1)).to.be.revertedWithCustomError(escrow, "DeliveryNotProven");
    await tracker.connect(farmer).initiateTransfer(id, distributor.address, "Farm gate", "");
    await tracker.connect(distributor).acceptTransfer(id);
    await expect(escrow.connect(outsider).releasePayment(1)).to.be.revertedWithCustomError(escrow, "NotOrderParty");
    const tx = await escrow.connect(farmer).releasePayment(1);
    await expect(tx).to.emit(escrow, "PaymentReleased");
    await expect(tx).to.changeTokenBalance(token, farmer, AMOUNT);
  });

  it("refund rules: seller any time; buyer only after deadline without custody", async () => {
    const ctx = await loadFixture(fundedFixture);
    const { escrow, token, distributor, farmer, outsider } = ctx;
    await expect(escrow.connect(distributor).requestRefund(1)).to.be.revertedWithCustomError(escrow, "RefundNotAvailable");
    await expect(escrow.connect(outsider).requestRefund(1)).to.be.revertedWithCustomError(escrow, "NotOrderParty");
    await time.increase(WINDOW + 1n);
    const tx = await escrow.connect(distributor).requestRefund(1);
    await expect(tx).to.emit(escrow, "PaymentRefunded");
    await expect(tx).to.changeTokenBalances(token, [escrow, distributor], [-AMOUNT, AMOUNT]);
    expect((await escrow.getOrderDetails(1)).status).to.equal(OrderStatus.Refunded);
    await expect(escrow.connect(distributor).requestRefund(1)).to.be.revertedWithCustomError(escrow, "InvalidOrderStatus");

    // Seller-initiated refund on a new order
    await escrow.connect(distributor).createOrder(ctx.id, farmer.address, AMOUNT, WINDOW);
    await escrow.connect(distributor).depositPayment(2);
    await expect(escrow.connect(farmer).requestRefund(2)).to.changeTokenBalance(token, distributor, AMOUNT);
  });

  it("buyer cannot claim a refund after taking custody, even past the deadline", async () => {
    const { escrow, tracker, distributor, farmer, id } = await loadFixture(fundedFixture);
    await tracker.connect(farmer).initiateTransfer(id, distributor.address, "", "");
    await tracker.connect(distributor).acceptTransfer(id);
    await time.increase(WINDOW + 1n);
    await expect(escrow.connect(distributor).requestRefund(1)).to.be.revertedWithCustomError(escrow, "RefundNotAvailable");
  });

  it("unfunded orders can be cancelled by either party", async () => {
    const { escrow, distributor, farmer, outsider, id } = await loadFixture(escrowFixture);
    await escrow.connect(distributor).createOrder(id, farmer.address, AMOUNT, WINDOW);
    await expect(escrow.connect(outsider).cancelOrder(1)).to.be.revertedWithCustomError(escrow, "NotOrderParty");
    await expect(escrow.connect(farmer).cancelOrder(1)).to.emit(escrow, "OrderCancelled");
    expect(await escrow.activeOrderForBatch(id)).to.equal(0n);
    await expect(escrow.connect(distributor).depositPayment(1)).to.be.revertedWithCustomError(escrow, "InvalidOrderStatus");
    await expect(escrow.connect(distributor).cancelOrder(1)).to.be.revertedWithCustomError(escrow, "InvalidOrderStatus");
  });

  it("pausing blocks new orders/deposits but never releases or refunds", async () => {
    const { escrow, admin, distributor, farmer, outsider, id } = await loadFixture(fundedFixture);
    await expect(escrow.connect(outsider).pause()).to.be.revertedWithCustomError(escrow, "NotAdmin");
    await escrow.connect(admin).pause();
    await expect(escrow.connect(distributor).createOrder(id, farmer.address, 1, WINDOW)).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    await escrow.connect(distributor).confirmDelivery(1); // still works
    await expect(escrow.connect(outsider).unpause()).to.be.revertedWithCustomError(escrow, "NotAdmin");
    await escrow.connect(admin).unpause();
  });

  it("has no admin path to escrowed funds", async () => {
    const { escrow } = await loadFixture(fundedFixture);
    const fns = escrow.interface.fragments.filter((f) => f.type === "function").map((f) => (f as any).name as string);
    expect(fns.some((n) => /withdraw|sweep|rescue|drain/i.test(n))).to.equal(false);
  });

  it("ReentrancyGuard blocks re-entrant withdrawals", async () => {
    const ctx = await loadFixture(deployWithParticipants);
    const id = await registerBatch(ctx);
    const evil = await ethers.deployContract("ReentrantToken");
    const escrow = await ethers.deployContract("PaymentEscrow", [
      await evil.getAddress(),
      await ctx.roleManager.getAddress(),
      await ctx.productRegistry.getAddress(),
    ]);
    await evil.transfer(ctx.distributor.address, AMOUNT);
    await evil.connect(ctx.distributor).approve(await escrow.getAddress(), AMOUNT);
    await escrow.connect(ctx.distributor).createOrder(id, ctx.farmer.address, AMOUNT, WINDOW);
    await escrow.connect(ctx.distributor).depositPayment(1);
    await evil.arm(await escrow.getAddress(), 1);
    await escrow.connect(ctx.distributor).confirmDelivery(1);
    expect(await evil.attackSucceeded()).to.equal(false);
    expect(await evil.balanceOf(await escrow.getAddress())).to.equal(0n);
    expect(await evil.balanceOf(ctx.farmer.address)).to.equal(AMOUNT);
  });

  it("constructor guards", async () => {
    await expect(ethers.deployContract("PaymentEscrow", [ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress])).to.be.reverted;
  });

  describe("FarmChainTestToken faucet", () => {
    it("mints test tokens with a cooldown", async () => {
      const { token, outsider } = await loadFixture(escrowFixture);
      await token.connect(outsider).faucet();
      expect(await token.balanceOf(outsider.address)).to.equal(ethers.parseEther("10000"));
      await expect(token.connect(outsider).faucet()).to.be.revertedWithCustomError(token, "FaucetCooldown");
      await time.increase(3601);
      await token.connect(outsider).faucet();
      expect(await token.balanceOf(outsider.address)).to.equal(ethers.parseEther("20000"));
    });
  });
});
