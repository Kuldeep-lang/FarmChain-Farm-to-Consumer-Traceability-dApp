import { render, screen, act } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { Interface, type ContractTransactionResponse } from "ethers";
import { QRCodeCard, generateQrSvg } from "@/components/QRCodeCard";
import { decodeError } from "@/blockchain/errors";
import { abis, traceUrl } from "@/blockchain/config";
import { useTransaction } from "@/hooks/useTransaction";
import { parseBatchId } from "@/utils/format";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() }) }));

describe("QR code generation", () => {
  it("encodes only the public trace URL", async () => {
    const svg = await generateQrSvg(traceUrl(10001));
    expect(svg).toContain("<svg");
    render(<QRCodeCard batchId={10001} productName="Organic Tomatoes" />);
    const img = await screen.findByTestId("qr-image");
    expect(img).toHaveAttribute("data-url", "http://localhost:3000/trace/10001".replace("http://localhost:3000", window.location.origin));
    expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(screen.getByText("FC-10001")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /png/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /print/i })).toBeEnabled();
  });

  it("scanned QR payloads are parsed back into batch IDs", () => {
    expect(parseBatchId("http://localhost:5173/trace/10001")).toBe(10001);
    expect(parseBatchId("https://farmchain.app/trace/FC-10042?ref=qr")).toBe(10042);
    expect(parseBatchId("FC-10001")).toBe(10001);
    expect(parseBatchId("hello world")).toBeNull();
  });
});

describe("Transaction error handling", () => {
  const iface = new Interface(abis.SupplyChainTracker);

  it("recognises wallet rejection", () => {
    expect(decodeError({ code: "ACTION_REJECTED" })).toMatchObject({ rejected: true, message: "Transaction rejected in your wallet." });
    expect(decodeError({ code: 4001, message: "User denied" }).rejected).toBe(true);
  });

  it("decodes contract custom errors into friendly messages", () => {
    const data = iface.encodeErrorResult("NotBatchOwner", ["0x70997970c51812dc3a010c7d01b50e0d17dc79c8"]);
    const d = decodeError({ code: "CALL_EXCEPTION", data, message: "execution reverted" });
    expect(d.code).toBe("NotBatchOwner");
    expect(d.message).toBe("You are not the current owner of this batch.");
    const nested = decodeError({ info: { error: { data: { data: iface.encodeErrorResult("InvalidTransfer", ["0x70997970c51812dc3a010c7d01b50e0d17dc79c8", "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"]) } } } });
    expect(nested.code).toBe("InvalidTransfer");
  });

  it("handles network errors and unknown errors", () => {
    expect(decodeError({ code: "NETWORK_ERROR" }).message).toMatch(/Cannot reach the blockchain/);
    expect(decodeError(new Error("weird")).message).toBe("weird");
  });

  it("useTransaction walks through phases and only confirms on a successful receipt", async () => {
    const { result } = renderHook(() => useTransaction());
    const ok = { hash: "0x" + "1".repeat(64), wait: vi.fn(async () => ({ status: 1, hash: "0x" + "1".repeat(64) })) } as unknown as ContractTransactionResponse;
    await act(async () => {
      await result.current.run("Test tx", async () => ok);
    });
    expect(result.current.state).toMatchObject({ phase: "confirmed", hash: ok.hash, error: null });
  });

  it("useTransaction reports reverted receipts as failed", async () => {
    const { result } = renderHook(() => useTransaction());
    const reverted = { hash: "0x" + "2".repeat(64), wait: vi.fn(async () => ({ status: 0 })) } as unknown as ContractTransactionResponse;
    let receipt: unknown = "unset";
    await act(async () => {
      receipt = await result.current.run("Test tx", async () => reverted);
    });
    expect(receipt).toBeNull();
    expect(result.current.state.phase).toBe("failed");
    expect(result.current.state.hash).toBe(reverted.hash);
  });

  it("useTransaction surfaces wallet rejection without a hash", async () => {
    const { result } = renderHook(() => useTransaction());
    await act(async () => {
      await result.current.run("Test tx", async () => {
        throw { code: "ACTION_REJECTED" };
      });
    });
    expect(result.current.state).toMatchObject({ phase: "failed", rejected: true, hash: null });
    expect(result.current.lastErrorCode()).toBe("ACTION_REJECTED");
  });
});
