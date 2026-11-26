import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WalletButton } from "@/components/WalletButton";
import { mockEthereum, renderWithProviders } from "./utils";

describe("Wallet connection states", () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as any).ethereum;
  });

  it("offers to install MetaMask when no wallet is injected", () => {
    renderWithProviders(<WalletButton />, { ethereum: null });
    expect(screen.getByRole("link", { name: /install metamask/i })).toHaveAttribute("href", "https://metamask.io/download/");
  });

  it("starts disconnected and does not fake a connection", () => {
    const eth = mockEthereum();
    renderWithProviders(<WalletButton />, { ethereum: eth });
    expect(screen.getByRole("button", { name: /connect wallet/i })).toBeInTheDocument();
    expect(eth.request).not.toHaveBeenCalledWith({ method: "eth_requestAccounts" });
  });

  it("connects through eth_requestAccounts and shows the short address", async () => {
    const eth = mockEthereum();
    renderWithProviders(<WalletButton />, { ethereum: eth });
    await userEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
    expect(await screen.findByText("0x7099…79c8")).toBeInTheDocument();
    expect(eth.request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
  });

  it("detects the wrong network and requests a switch", async () => {
    const eth = mockEthereum({ chainId: 1 });
    renderWithProviders(<WalletButton />, { ethereum: eth });
    await userEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
    const switchBtn = await screen.findByRole("button", { name: /switch to hardhat local/i });
    await userEvent.click(switchBtn);
    expect(eth.request).toHaveBeenCalledWith({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x7a69" }] });
    expect(await screen.findByText("0x7099…79c8")).toBeInTheDocument();
  });

  it("stays disconnected when the user rejects the connection", async () => {
    const eth = mockEthereum({ rejectConnect: true });
    renderWithProviders(<WalletButton />, { ethereum: eth });
    await userEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /connect wallet/i })).toBeInTheDocument());
  });

  it("disconnects and reacts to accountsChanged", async () => {
    const eth = mockEthereum();
    renderWithProviders(<WalletButton />, { ethereum: eth });
    await userEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
    await screen.findByText("0x7099…79c8");
    eth.emit("accountsChanged", []);
    expect(await screen.findByRole("button", { name: /connect wallet/i })).toBeInTheDocument();
  });
});
