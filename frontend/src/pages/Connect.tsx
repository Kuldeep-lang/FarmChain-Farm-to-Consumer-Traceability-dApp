import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { NetworkPill } from "@/components/common";
import { useWallet } from "@/context/WalletContext";
import { dashboardPath, useParticipant } from "@/hooks/useParticipant";
import { CONTRACTS_READY, NETWORK, networkName } from "@/blockchain/config";
import { shortAddress } from "@/utils/format";

/** Wallet authentication: connect → check network → read on-chain identity → redirect. */
export function Connect() {
  const { status, account, chainId, isCorrectNetwork, connect, switchNetwork, error } = useWallet();
  const { isLoading, isError, participant, isAdmin, isVerified, role, error: readError, refetch } = useParticipant();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;

  useEffect(() => {
    if (status !== "connected" || !isCorrectNetwork || isLoading || isError || !CONTRACTS_READY) return;
    if (!participant && !isAdmin) navigate("/register", { replace: true });
    else navigate(from && from !== "/connect" ? from : dashboardPath(role, isAdmin, isVerified), { replace: true });
  }, [status, isCorrectNetwork, isLoading, isError, participant, isAdmin, isVerified, role, navigate, from]);

  return (
    <div className="container flex min-h-[70vh] items-center justify-center py-16">
      <Card className="w-full max-w-md p-8">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent text-forest">
          <Wallet className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-center text-2xl font-semibold tracking-tight text-ink">Connect your wallet</h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          FarmChain uses your wallet instead of a password. Your role and verification are read from the smart contracts.
        </p>

        <div className="mt-6 space-y-3">
          {status === "unavailable" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              MetaMask was not detected.{" "}
              <a className="font-medium underline" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                Install MetaMask
              </a>{" "}
              and reload this page. Consumers can still <Link to="/scan" className="font-medium underline">trace products</Link> without a wallet.
            </div>
          )}

          {(status === "disconnected" || status === "connecting") && (
            <Button className="w-full" size="lg" onClick={connect} loading={status === "connecting"}>
              {status === "connecting" ? "Waiting for MetaMask…" : "Connect MetaMask"}
            </Button>
          )}

          {status === "connected" && account && (
            <div className="space-y-3 rounded-lg border bg-slate-50 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Wallet</span>
                <span className="mono text-ink">{shortAddress(account, 6)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Network</span>
                <span className="flex items-center gap-2">
                  {networkName(chainId)} <NetworkPill chainId={chainId} />
                </span>
              </div>
              {!isCorrectNetwork ? (
                <div className="space-y-2 border-t pt-3">
                  <p className="flex items-start gap-2 text-sm text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> FarmChain is deployed on {NETWORK.name} (chain {NETWORK.chainId}).
                  </p>
                  <Button className="w-full" onClick={switchNetwork}>Switch to {NETWORK.name}</Button>
                </div>
              ) : !CONTRACTS_READY ? (
                <p className="border-t pt-3 text-sm text-amber-800">Contracts are not configured for this network. Deploy them first (see README).</p>
              ) : isLoading ? (
                <p className="flex items-center gap-2 border-t pt-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking registration on-chain…
                </p>
              ) : isError ? (
                <div className="space-y-2 border-t pt-3">
                  <p className="text-sm text-destructive">Could not read the blockchain: {(readError as Error)?.message}</p>
                  <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
                </div>
              ) : (
                <p className="flex items-center gap-2 border-t pt-3 text-sm text-forest">
                  <CheckCircle2 className="h-4 w-4" /> Identity loaded. Redirecting…
                </p>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>

        <div className="mt-6 flex items-start gap-2 rounded-lg bg-accent/60 p-3 text-xs text-forest">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          FarmChain never asks for your seed phrase. Connecting only shares your public address.
        </div>
      </Card>
    </div>
  );
}
