import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "./utils";
import type { Batch, HistoryEntry, Participant } from "@/blockchain/reads";

const FARMER = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const DIST = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";

const batch: Batch = {
  id: 10001, farmer: FARMER, productName: "Organic Tomatoes", category: "Vegetables", quantity: 500, unit: "kg",
  harvestDate: new Date("2026-11-17"), farmLocation: "Coimbatore, Tamil Nadu, India", metadataCID: "", createdAt: new Date("2026-11-18"),
  currentOwner: DIST, status: "IN_TRANSIT",
};
const entry = (index: number, action: HistoryEntry["action"], stage: HistoryEntry["stage"], actor: string, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
  index, batchId: 10001, action, stage, actor, previousOwner: FARMER, newOwner: actor, timestamp: new Date(2026, 10, 17 + index), location: "Coimbatore", metadataCID: "",
  txHash: "0x" + String(index).repeat(64).slice(0, 64), txHashSource: "chain", ...extra,
});
const history = [
  entry(0, "Harvested", "HARVESTED", FARMER),
  entry(1, "Registered", "REGISTERED", FARMER),
  entry(2, "TransferInitiated", "REGISTERED", FARMER, { newOwner: DIST }),
  entry(3, "TransferAccepted", "REGISTERED", DIST),
  entry(4, "ShipmentRecorded", "IN_TRANSIT", DIST, { location: "NH544 Coimbatore → Chennai" }),
];
const participant = (wallet: string, name: string, role: Participant["role"]): Participant => ({
  wallet, name, organization: `${name} Org`, location: "Coimbatore", role, registeredAt: new Date("2026-11-01"), updatedAt: new Date(), verification: "Verified", roleActive: true,
});

const reads = vi.hoisted(() => ({
  fetchBatch: vi.fn(),
  fetchBatchHistory: vi.fn(),
  fetchParticipant: vi.fn(),
  fetchWalletStatus: vi.fn(),
}));
vi.mock("@/blockchain/reads", async (orig) => ({ ...(await orig<object>()), ...reads }));

describe("Consumer traceability page", () => {
  beforeEach(() => {
    reads.fetchBatch.mockResolvedValue(batch);
    reads.fetchBatchHistory.mockResolvedValue(history);
    reads.fetchParticipant.mockImplementation(async (a: string) =>
      a.toLowerCase() === FARMER ? participant(FARMER, "Ravi Kumar", "Farmer") : participant(DIST, "Kovai Logistics", "Distributor"),
    );
  });

  it("shows product, farmer and the verified on-chain journey without a wallet", async () => {
    const { Trace } = await import("@/pages/Trace");
    renderWithProviders(<Trace />, { route: "/trace/10001", path: "/trace/:batchId", ethereum: null });

    expect(await screen.findByRole("heading", { name: "Organic Tomatoes" })).toBeInTheDocument();
    expect(screen.getAllByText("FC-10001").length).toBeGreaterThan(0);
    expect(screen.getByText("500 kg")).toBeInTheDocument();
    expect((await screen.findAllByText("Ravi Kumar")).length).toBeGreaterThan(0);

    const entries = await screen.findAllByTestId("timeline-entry");
    expect(entries).toHaveLength(5);
    expect(within(entries[3]).getByText("Collected by distributor")).toBeInTheDocument();
    expect(within(entries[4]).getByText("NH544 Coimbatore → Chennai")).toBeInTheDocument();
    expect(within(entries[4]).getByText("Verified on-chain")).toBeInTheDocument();

    // explicit distinction between on-chain records and off-chain documents
    expect(screen.getAllByText("On-chain verified").length).toBeGreaterThan(0);
    expect(screen.getByText("Off-chain document")).toBeInTheDocument();
    expect(screen.getByText(/No off-chain metadata was attached/)).toBeInTheDocument();
    expect(screen.getByText(/local development network/i)).toBeInTheDocument();
  });

  it("reports unknown batches clearly", async () => {
    reads.fetchBatch.mockResolvedValue(null);
    const { Trace } = await import("@/pages/Trace");
    renderWithProviders(<Trace />, { route: "/trace/99999", path: "/trace/:batchId", ethereum: null });
    expect(await screen.findByText(/was not found on-chain/)).toBeInTheDocument();
  });

  it("shows a recall banner for recalled batches", async () => {
    reads.fetchBatch.mockResolvedValue({ ...batch, status: "RECALLED" });
    const { Trace } = await import("@/pages/Trace");
    renderWithProviders(<Trace />, { route: "/trace/10001", path: "/trace/:batchId", ethereum: null });
    expect(await screen.findByText(/has been RECALLED/)).toBeInTheDocument();
  });
});

describe("Role-specific dashboard access", () => {
  const participantHook = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
  vi.mock("@/hooks/useParticipant", async (orig) => ({ ...(await orig<object>()), useParticipant: () => participantHook.value }));

  const base = { isLoading: false, isError: false, error: null, isAdmin: false, connected: true };

  it("allows a verified farmer into the farmer area", async () => {
    participantHook.value = { ...base, isVerified: true, role: "Farmer", participant: participant(FARMER, "Ravi", "Farmer") };
    const { RequireRole } = await import("@/components/RequireRole");
    renderWithProviders(<RequireRole roles={["Farmer"]}><p>farmer content</p></RequireRole>);
    expect(screen.getByText("farmer content")).toBeInTheDocument();
  });

  it("blocks a distributor from the farmer area", async () => {
    participantHook.value = { ...base, isVerified: true, role: "Distributor", participant: participant(DIST, "Kovai", "Distributor") };
    const { RequireRole } = await import("@/components/RequireRole");
    renderWithProviders(<RequireRole roles={["Farmer"]}><p>farmer content</p></RequireRole>);
    expect(screen.queryByText("farmer content")).not.toBeInTheDocument();
    expect(screen.getByText(/Your on-chain role is Distributor/)).toBeInTheDocument();
  });

  it("blocks pending participants until an admin verifies them", async () => {
    participantHook.value = { ...base, isVerified: false, role: "Farmer", participant: { ...participant(FARMER, "Ravi", "Farmer"), verification: "Pending", roleActive: false } };
    const { RequireRole } = await import("@/components/RequireRole");
    renderWithProviders(<RequireRole roles={["Farmer"]}><p>farmer content</p></RequireRole>);
    expect(screen.getByText(/registration is pending/)).toBeInTheDocument();
  });

  it("admin area requires the on-chain admin role", async () => {
    participantHook.value = { ...base, isVerified: true, role: "Farmer", participant: participant(FARMER, "Ravi", "Farmer"), isAdmin: false };
    const { RequireRole } = await import("@/components/RequireRole");
    const { unmount } = renderWithProviders(<RequireRole admin><p>admin content</p></RequireRole>);
    expect(screen.getByText(/requires the on-chain administrator role/)).toBeInTheDocument();
    unmount();
    participantHook.value = { ...participantHook.value, isAdmin: true };
    renderWithProviders(<RequireRole admin><p>admin content</p></RequireRole>);
    expect(screen.getByText("admin content")).toBeInTheDocument();
  });
});
