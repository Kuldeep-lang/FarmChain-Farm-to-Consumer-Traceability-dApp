import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ChevronDown, LayoutDashboard, LogOut, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/context/WalletContext";
import { NETWORK, networkName } from "@/blockchain/config";
import { shortAddress } from "@/utils/format";
import { CopyButton } from "./common";
import { cn } from "@/utils/cn";

/** Connect / network / account control used in every header. */
export function WalletButton({ className, compact }: { className?: string; compact?: boolean }) {
  const { status, account, chainId, isCorrectNetwork, connect, disconnect, switchNetwork } = useWallet();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  if (status === "unavailable") {
    return (
      <Button asChild variant="outline" className={className}>
        <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">
          <Wallet /> Install MetaMask
        </a>
      </Button>
    );
  }

  if (status !== "connected" || !account) {
    return (
      <Button onClick={connect} loading={status === "connecting"} className={className}>
        {status !== "connecting" && <Wallet />} {status === "connecting" ? "Connecting…" : "Connect Wallet"}
      </Button>
    );
  }

  if (!isCorrectNetwork) {
    return (
      <Button variant="outline" onClick={switchNetwork} className={cn("border-amber-300 text-amber-700 hover:bg-amber-50", className)}>
        <AlertTriangle /> Switch to {NETWORK.name}
      </Button>
    );
  }

  return (
    <div className={cn("relative", className)}>
      <Button variant="outline" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <span className="h-2 w-2 rounded-full bg-secondary" />
        <span className="mono text-xs">{shortAddress(account)}</span>
        {!compact && <ChevronDown className="text-muted-foreground" />}
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute right-0 z-50 mt-2 w-64 rounded-xl border bg-white p-2 shadow-lift">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-muted-foreground">Connected wallet</p>
              <div className="mt-0.5 flex items-center justify-between">
                <span className="mono text-sm text-ink">{shortAddress(account, 6)}</span>
                <CopyButton value={account} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Network: {networkName(chainId)}</p>
            </div>
            <button
              role="menuitem"
              className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
              onClick={() => {
                setOpen(false);
                navigate("/connect");
              }}
            >
              <LayoutDashboard className="h-4 w-4" /> My dashboard
            </button>
            <button
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive hover:bg-red-50"
              onClick={async () => {
                setOpen(false);
                await disconnect();
                navigate("/");
              }}
            >
              <LogOut className="h-4 w-4" /> Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}
