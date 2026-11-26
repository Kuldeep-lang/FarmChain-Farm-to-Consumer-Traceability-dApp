import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WalletProvider } from "@/context/WalletContext";

/** Minimal EIP-1193 provider mock. */
export function mockEthereum(opts: { accounts?: string[]; chainId?: number; rejectConnect?: boolean } = {}) {
  const listeners: Record<string, ((...a: any[]) => void)[]> = {};
  let accounts = opts.accounts ?? [];
  let chainId = opts.chainId ?? 31337;
  const eth = {
    isMetaMask: true,
    request: vi.fn(async ({ method }: { method: string }) => {
      switch (method) {
        case "eth_requestAccounts":
          if (opts.rejectConnect) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
          accounts = opts.accounts?.length ? opts.accounts : ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8"];
          return accounts;
        case "eth_accounts":
          return accounts;
        case "eth_chainId":
          return `0x${chainId.toString(16)}`;
        case "wallet_switchEthereumChain":
          chainId = 31337;
          listeners.chainChanged?.forEach((l) => l("0x7a69"));
          return null;
        default:
          return null;
      }
    }),
    on: (e: string, l: (...a: any[]) => void) => {
      (listeners[e] ??= []).push(l);
    },
    removeListener: (e: string, l: (...a: any[]) => void) => {
      listeners[e] = (listeners[e] ?? []).filter((x) => x !== l);
    },
    emit: (e: string, ...args: unknown[]) => listeners[e]?.forEach((l) => l(...args)),
  };
  return eth;
}

export function renderWithProviders(ui: ReactNode, opts: { route?: string; path?: string; ethereum?: Eip1193Provider | null } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const eth = opts.ethereum === null ? undefined : (opts.ethereum ?? undefined);
  return render(
    <QueryClientProvider client={client}>
      <WalletProvider ethereum={eth}>
        <MemoryRouter initialEntries={[opts.route ?? "/"]}>
          <Routes>
            <Route path={opts.path ?? "*"} element={ui} />
          </Routes>
        </MemoryRouter>
      </WalletProvider>
    </QueryClientProvider>,
  );
}
