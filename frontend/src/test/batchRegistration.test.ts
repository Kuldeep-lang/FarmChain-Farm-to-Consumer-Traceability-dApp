import { Interface, type TransactionReceipt } from "ethers";
import { registerBatchFlow, RegistrationError, type RegistrationDeps } from "@/services/batchRegistration";
import { abis } from "@/blockchain/config";

const iface = new Interface(abis.ProductRegistry);
const FARMER = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

function receiptFor(batchId: bigint): TransactionReceipt {
  const { data, topics } = iface.encodeEventLog(iface.getEvent("BatchRegistered")!, [batchId, FARMER, "Organic Tomatoes", "Vegetables", 500n, "kg", "bafymeta", 1n]);
  return { hash: "0x" + "ab".repeat(32), status: 1, logs: [{ topics, data, address: "0x0000000000000000000000000000000000000001" }] } as unknown as TransactionReceipt;
}

const values = {
  productName: "Organic Tomatoes",
  category: "Vegetables",
  description: "Grown without pesticides",
  quantity: 500,
  unit: "kg",
  harvestDate: Math.floor(Date.now() / 1000),
  farmLocation: "Pollachi, Coimbatore, Tamil Nadu",
  state: "Tamil Nadu",
  district: "Coimbatore",
};

function deps(over: Partial<RegistrationDeps> = {}): RegistrationDeps {
  let next = 10001n;
  return {
    farmer: FARMER,
    ipfsConfigured: true,
    photo: new File([new Uint8Array([0x89, 0x50])], "farm.png", { type: "image/png" }),
    certificate: new File(["%PDF-1.7"], "cert.pdf", { type: "application/pdf" }),
    getToken: vi.fn(async () => "jwt"),
    uploadFile: vi.fn(async (_t: string, f: File) => ({ cid: f.name === "farm.png" ? "bafyimage" : "bafycert" })),
    uploadJson: vi.fn(async () => ({ cid: "bafymeta" })),
    nextBatchId: vi.fn(async () => next),
    sendRegister: vi.fn(async (id: bigint) => receiptFor(id)),
    registryInterface: iface,
    onStep: vi.fn(),
    lastError: () => undefined,
    ...over,
    // allow tests to bump the id
    ...(over.nextBatchId ? {} : { nextBatchId: vi.fn(async () => next++) }),
  };
}

describe("Batch registration workflow", () => {
  it("uploads files, embeds the real batch ID and CIDs in metadata, then registers on-chain", async () => {
    const d = deps();
    const res = await registerBatchFlow(values, d);

    expect(d.uploadFile).toHaveBeenCalledTimes(2);
    const [, name, metadata] = (d.uploadJson as any).mock.calls[0];
    expect(name).toBe("FC-10001-metadata");
    expect(metadata).toMatchObject({ batchId: "FC-10001", imageCID: "bafyimage", certificationCID: "bafycert", farmerWallet: FARMER, quantity: 500 });

    const [expectedId, input] = (d.sendRegister as any).mock.calls[0];
    expect(expectedId).toBe(10001n);
    expect(input).toMatchObject({ productName: "Organic Tomatoes", quantity: 500n, metadataCID: "bafymeta" });

    expect(res).toMatchObject({ batchId: 10001, metadataCID: "bafymeta", imageCID: "bafyimage", certificationCID: "bafycert" });
    expect((d.onStep as any).mock.calls.map((c: unknown[]) => c[0])).toEqual(["validating", "uploading_files", "uploading_metadata", "awaiting_tx", "confirmed"]);
  });

  it("never reports success when the transaction fails", async () => {
    const d = deps({ sendRegister: vi.fn(async () => null) });
    await expect(registerBatchFlow(values, d)).rejects.toBeInstanceOf(RegistrationError);
  });

  it("retries once with rebuilt metadata when another farmer took the expected ID", async () => {
    let call = 0;
    let lastErr: string | undefined;
    const d = deps({
      sendRegister: vi.fn(async (id: bigint) => {
        call++;
        if (call === 1) {
          lastErr = "BatchIdMismatch";
          return null;
        }
        return receiptFor(id);
      }),
      lastError: () => lastErr,
    });
    const res = await registerBatchFlow(values, d);
    expect(d.sendRegister).toHaveBeenCalledTimes(2);
    expect((d.uploadJson as any).mock.calls[1][2].batchId).toBe("FC-10002");
    expect(res.batchId).toBe(10002);
  });

  it("refuses to upload files when IPFS is not configured (no fake CIDs)", async () => {
    const d = deps({ ipfsConfigured: false });
    await expect(registerBatchFlow(values, d)).rejects.toThrow(/IPFS is not configured/);
    expect(d.sendRegister).not.toHaveBeenCalled();
  });

  it("registers without metadata (empty CID) only when explicitly IPFS-less and file-less", async () => {
    const d = deps({ ipfsConfigured: false, photo: null, certificate: null });
    const res = await registerBatchFlow(values, d);
    expect(d.uploadJson).not.toHaveBeenCalled();
    expect((d.sendRegister as any).mock.calls[0][1].metadataCID).toBe("");
    expect(res.metadataCID).toBe("");
  });

  it("errors if a confirmed receipt has no BatchRegistered event", async () => {
    const d = deps({ sendRegister: vi.fn(async () => ({ hash: "0x1", status: 1, logs: [] }) as unknown as TransactionReceipt) });
    await expect(registerBatchFlow(values, d)).rejects.toThrow(/no BatchRegistered event/);
  });
});
