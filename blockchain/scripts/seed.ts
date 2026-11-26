import { ethers, network } from "hardhat";
import { loadDeployment } from "./lib/deployment";

/**
 * LOCAL DEMO SEED (Hardhat network only).
 *
 * Creates demo participants from the well-known Hardhat test accounts and real on-chain sample
 * batches. Every record below is produced by genuine transactions on the local chain; the
 * participants are visibly labelled "(Demo)" so they can never be mistaken for real entities.
 * Seeded batches carry no IPFS metadata (empty CID) because uploading requires credentials –
 * register a batch through the UI to exercise the IPFS flow.
 *
 * Accounts (from `npx hardhat node`):
 *   #0 admin  #1 farmer  #2 distributor  #3 warehouse  #4 retailer
 */
const Role = { Farmer: 1, Distributor: 2, Warehouse: 3, Retailer: 4 };
const Stage = { AVAILABLE_FOR_SALE: 7 };

async function main() {
  if (network.name !== "localhost" && network.name !== "hardhat") {
    throw new Error("The seed script is for local development only.");
  }
  const d = loadDeployment(network.name);
  const [admin, farmer, distributor, warehouse, retailer] = await ethers.getSigners();

  const roleManager = await ethers.getContractAt("RoleManager", d.contracts.RoleManager);
  const userRegistry = await ethers.getContractAt("UserRegistry", d.contracts.UserRegistry);
  const productRegistry = await ethers.getContractAt("ProductRegistry", d.contracts.ProductRegistry);
  const tracker = await ethers.getContractAt("SupplyChainTracker", d.contracts.SupplyChainTracker);
  const escrow = await ethers.getContractAt("PaymentEscrow", d.contracts.PaymentEscrow);
  const token = await ethers.getContractAt("FarmChainTestToken", d.contracts.FarmChainTestToken);

  const send = async (label: string, p: Promise<{ wait(): Promise<{ hash: string } | null> }>) => {
    const r = await (await p).wait();
    console.log(`  ✓ ${label}${r ? `  (${r.hash.slice(0, 12)}…)` : ""}`);
  };

  console.log("\nParticipants");
  const people = [
    { s: farmer, name: "Ravi Kumar (Demo)", org: "Green Valley Farms (Demo)", loc: "Coimbatore, Tamil Nadu", role: Role.Farmer },
    { s: distributor, name: "Arun Logistics (Demo)", org: "Kovai Transport Co. (Demo)", loc: "Coimbatore, Tamil Nadu", role: Role.Distributor },
    { s: warehouse, name: "Meena Storage (Demo)", org: "TN Cold Chain Hub (Demo)", loc: "Chennai, Tamil Nadu", role: Role.Warehouse },
    { s: retailer, name: "Priya Stores (Demo)", org: "FreshMart T. Nagar (Demo)", loc: "Chennai, Tamil Nadu", role: Role.Retailer },
  ];
  for (const p of people) {
    if (!(await userRegistry.isRegistered(p.s.address))) {
      await send(`register ${p.name}`, userRegistry.connect(p.s).registerUser(p.name, p.org, p.loc, p.role));
    }
    if (!(await roleManager.isVerifiedParticipant(p.s.address))) {
      await send(`verify ${p.name}`, roleManager.connect(admin).verifyParticipant(p.s.address));
    }
    if ((await token.balanceOf(p.s.address)) < ethers.parseEther("1000")) {
      await send(`fund ${p.name} with 50,000 fUSD`, token.connect(admin).transfer(p.s.address, ethers.parseEther("50000")));
    }
  }

  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
  const day = 86400;
  const register = async (productName: string, category: string, quantity: number, unit: string, daysAgo: number, farmLocation: string) => {
    const id = await productRegistry.nextBatchId();
    await send(
      `register batch FC-${id} ${productName}`,
      productRegistry.connect(farmer).registerBatch(id, {
        productName,
        category,
        quantity,
        unit,
        harvestDate: now - daysAgo * day,
        farmLocation,
        metadataCID: "",
      }),
    );
    return id;
  };

  console.log("\nBatch 1 – full journey to retail shelf, paid through escrow");
  const b1 = await register("Organic Tomatoes", "Vegetables", 500, "kg", 1, "Coimbatore, Tamil Nadu, India");
  const price = ethers.parseEther("2500");
  await send("distributor approves escrow", token.connect(distributor).approve(d.contracts.PaymentEscrow, price));
  const orderId = await escrow.nextOrderId();
  await send(`create order #${orderId}`, escrow.connect(distributor).createOrder(b1, farmer.address, price, 7 * day));
  await send("deposit payment", escrow.connect(distributor).depositPayment(orderId));
  await send("farmer -> distributor transfer", tracker.connect(farmer).initiateTransfer(b1, distributor.address, "Green Valley Farms gate, Coimbatore", ""));
  await send("distributor accepts", tracker.connect(distributor).acceptTransfer(b1));
  await send("escrow released on custody proof", escrow.connect(farmer).releasePayment(orderId));
  await send("shipment recorded", tracker.connect(distributor).recordShipment(b1, "NH544 Coimbatore → Chennai (TN-37-AB-1234)", ""));
  await send("distributor -> warehouse transfer", tracker.connect(distributor).initiateTransfer(b1, warehouse.address, "TN Cold Chain Hub, Chennai", ""));
  await send("warehouse accepts", tracker.connect(warehouse).acceptTransfer(b1));
  await send("warehouse arrival", tracker.connect(warehouse).recordWarehouseArrival(b1, "TN Cold Chain Hub – Room 3 (4°C, 90% RH)", ""));
  await send("quality inspection passed", tracker.connect(warehouse).recordQualityInspection(b1, true, "TN Cold Chain Hub QA Lab", ""));
  await send("warehouse -> retailer transfer", tracker.connect(warehouse).initiateTransfer(b1, retailer.address, "TN Cold Chain Hub, Chennai", ""));
  await send("retailer accepts", tracker.connect(retailer).acceptTransfer(b1));
  await send("retail arrival", tracker.connect(retailer).recordRetailArrival(b1, "FreshMart, T. Nagar, Chennai", ""));
  await send("available for sale", tracker.connect(retailer).updateBatchStatus(b1, Stage.AVAILABLE_FOR_SALE, "FreshMart, T. Nagar, Chennai", ""));

  console.log("\nBatch 2 – at warehouse, quality checked");
  const b2 = await register("Ponni Rice", "Grains", 2, "tonnes", 6, "Thanjavur, Tamil Nadu, India");
  await send("farmer -> distributor", tracker.connect(farmer).initiateTransfer(b2, distributor.address, "Thanjavur farm gate", ""));
  await send("distributor accepts", tracker.connect(distributor).acceptTransfer(b2));
  await send("shipment", tracker.connect(distributor).recordShipment(b2, "Thanjavur → Chennai", ""));
  await send("distributor -> warehouse", tracker.connect(distributor).initiateTransfer(b2, warehouse.address, "Chennai", ""));
  await send("warehouse accepts", tracker.connect(warehouse).acceptTransfer(b2));
  await send("warehouse arrival", tracker.connect(warehouse).recordWarehouseArrival(b2, "TN Cold Chain Hub – Dry store B", ""));
  await send("quality inspection", tracker.connect(warehouse).recordQualityInspection(b2, true, "TN Cold Chain Hub QA Lab", ""));

  console.log("\nBatch 3 – in transit with distributor");
  const b3 = await register("Nendran Bananas", "Fruits", 800, "kg", 2, "Pollachi, Tamil Nadu, India");
  await send("farmer -> distributor", tracker.connect(farmer).initiateTransfer(b3, distributor.address, "Pollachi farm gate", ""));
  await send("distributor accepts", tracker.connect(distributor).acceptTransfer(b3));
  await send("shipment", tracker.connect(distributor).recordShipment(b3, "Pollachi → Coimbatore depot", ""));

  console.log("\nBatch 4 – transfer awaiting distributor acceptance");
  const b4 = await register("Alphonso Mangoes", "Fruits", 300, "kg", 0, "Krishnagiri, Tamil Nadu, India");
  await send("farmer -> distributor (pending)", tracker.connect(farmer).initiateTransfer(b4, distributor.address, "Krishnagiri farm gate", ""));

  console.log("\nBatch 5 – registered, still at the farm");
  await register("Erode Turmeric", "Spices", 150, "kg", 10, "Erode, Tamil Nadu, India");

  console.log(`\nSeed complete. Try the traceability page: http://localhost:5173/trace/${b1}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
