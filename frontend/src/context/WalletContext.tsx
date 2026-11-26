import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BrowserProvider, type JsonRpcSigner } from "ethers";
import { NETWORK } from "@/blockchain/config";
import { decodeError } from "@/blockchain/errors";
import { clearApiSession } from "@/services/api";

export type WalletStatus = "unavailable" | "disconnected" | "connecting" | "connected";

interface WalletState {
  status: WalletStatus;
  account: string | null;
  chainId: number | null;
  isCorrectNetwork: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
  getSigner: () => Promise<JsonRpcSigner>;
}

const WalletContext = createContext<WalletState | null>(null);
const STORAGE_KEY = "farmchain.wallet.connected";

const safeStorage = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  },
};

export function WalletProvider({ children, ethereum }: { children: ReactNode; ethereum?: Eip1193Provider }) {
  const eth = ethereum ?? (typeof window !== "undefined" ? window.ethereum : undefined);
  // If the user connected before, start in "connecting" while the silent reconnect runs so
  // protected pages don't bounce to /connect on reload.
  const [status, setStatus] = useState<WalletStatus>(eth ? (safeStorage.get(STORAGE_KEY) === "1" ? "connecting" : "disconnected") : "unavailable");
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const providerRef = useRef<BrowserProvider | null>(null);

  const provider = useCallback(() => {
    if (!eth) throw new Error("MetaMask is not installed");
    if (!providerRef.current) providerRef.current = new BrowserProvider(eth, "any");
    return providerRef.current;
  }, [eth]);

  const readChain = useCallback(async () => {
    if (!eth) return;
    const hex = (await eth.request({ method: "eth_chainId" })) as string;
    setChainId(Number.parseInt(hex, 16));
  }, [eth]);

  // Silent reconnect (no popup) if the user connected before.
  useEffect(() => {
    if (!eth || safeStorage.get(STORAGE_KEY) !== "1") return;
    (async () => {
      try {
        const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
        if (accounts.length) {
          setAccount(accounts[0].toLowerCase());
          await readChain();
          setStatus("connected");
        } else {
          setStatus("disconnected");
          safeStorage.set(STORAGE_KEY, null);
        }
      } catch {
        setStatus("disconnected");
      }
    })();
  }, [eth, readChain]);

  // React to wallet events.
  useEffect(() => {
    if (!eth?.on) return;
    const onAccounts = (accounts: string[]) => {
      providerRef.current = null;
      if (!accounts.length) {
        setAccount(null);
        setStatus("disconnected");
        safeStorage.set(STORAGE_KEY, null);
      } else {
        setAccount(accounts[0].toLowerCase());
        setStatus("connected");
      }
    };
    const onChain = (hex: string) => {
      providerRef.current = null;
      setChainId(Number.parseInt(hex, 16));
    };
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [eth]);

  const connect = useCallback(async () => {
    if (!eth) {
      setError("MetaMask is not installed. Install it from metamask.io to continue.");
      return;
    }
    setStatus("connecting");
    setError(null);
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts.length) throw new Error("No account authorised");
      setAccount(accounts[0].toLowerCase());
      await readChain();
      setStatus("connected");
      safeStorage.set(STORAGE_KEY, "1");
    } catch (err) {
      setStatus("disconnected");
      const d = decodeError(err);
      setError(d.rejected ? "Connection request was rejected in MetaMask." : d.message);
    }
  }, [eth, readChain]);

  const disconnect = useCallback(async () => {
    if (account) clearApiSession(account);
    setAccount(null);
    setStatus(eth ? "disconnected" : "unavailable");
    safeStorage.set(STORAGE_KEY, null);
    providerRef.current = null;
    // Ask MetaMask to drop the site permission where supported (EIP-2255).
    try {
      await eth?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
    } catch {
      /* not supported – local disconnect is enough */
    }
  }, [account, eth]);

  const switchNetwork = useCallback(async () => {
    if (!eth) return;
    const hexId = `0x${NETWORK.chainId.toString(16)}`;
    setError(null);
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 4902 || code === -32603) {
        try {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: hexId,
                chainName: NETWORK.name,
                rpcUrls: [NETWORK.rpcUrl],
                nativeCurrency: NETWORK.currency,
                blockExplorerUrls: NETWORK.explorer ? [NETWORK.explorer] : undefined,
              },
            ],
          });
        } catch (addErr) {
          setError(decodeError(addErr).message);
        }
      } else {
        setError(decodeError(err).message);
      }
    }
  }, [eth]);

  const getSigner = useCallback(async () => {
    if (!account) throw new Error("Connect your wallet first");
    if (chainId !== NETWORK.chainId) throw new Error(`Switch MetaMask to ${NETWORK.name} first`);
    return provider().getSigner(account);
  }, [account, chainId, provider]);

  const value = useMemo<WalletState>(
    () => ({
      status,
      account,
      chainId,
      isCorrectNetwork: chainId === NETWORK.chainId,
      error,
      connect,
      disconnect,
      switchNetwork,
      getSigner,
    }),
    [status, account, chainId, error, connect, disconnect, switchNetwork, getSigner],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
