import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  Copy,
  Database,
  ExternalLink,
  FileText,
  Inbox,
  Link2,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Wallet,
  XCircle,
} from "lucide-react";
import { Badge, Card } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";
import { shortAddress, shortHash } from "@/utils/format";
import { addressExplorerUrl, NETWORK, txExplorerUrl } from "@/blockchain/config";
import { STAGE_LABEL, lifecycle, type StageName, type VerificationName } from "@/blockchain/enums";
import type { TxState } from "@/hooks/useTransaction";

/* ---------------------------------------------------------------- Brand */
export function Logo({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <Link to="/" className={cn("flex items-center gap-2.5 font-semibold tracking-tight", className)} aria-label="FarmChain home">
      <span className={cn("grid h-8 w-8 place-items-center rounded-lg", inverted ? "bg-forest-100" : "bg-forest")}>
        <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden>
          <path
            d="M16 7c-4.5 2-7 5.6-7 9.6 0 3.6 2.6 6.4 6 7V26h2v-2.4c3.4-.6 6-3.4 6-7C23 12.6 20.5 9 16 7Zm1 14.5v-5.3l3-3-1.4-1.4-1.6 1.6V10.8c2.4 1.6 4 3.6 4 5.8 0 2.4-1.7 4.3-4 4.9Zm-2 0c-2.3-.6-4-2.5-4-4.9 0-2.2 1.6-4.2 4-5.8v4.6l-1.6-1.6L12 13.2l3 3v5.3Z"
            fill={inverted ? "#14532D" : "#DCFCE7"}
          />
        </svg>
      </span>
      <span className={cn("text-lg", inverted ? "text-white" : "text-ink")}>
        Farm<span className={inverted ? "text-forest-100" : "text-secondary"}>Chain</span>
      </span>
    </Link>
  );
}

/* ---------------------------------------------------------------- Copy + address */
export function CopyButton({ value, className }: { value: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={cn("rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-ink", className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          /* clipboard blocked */
        }
      }}
      aria-label="Copy to clipboard"
    >
      {done ? <Check className="h-3.5 w-3.5 text-secondary" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function AddressDisplay({ address, label, className }: { address: string; label?: string | null; className?: string }) {
  const url = addressExplorerUrl(address);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      {label && <span className="truncate font-medium text-ink">{label}</span>}
      <span className={cn("mono truncate text-xs", label ? "text-muted-foreground" : "text-ink")} title={address}>
        {shortAddress(address)}
      </span>
      <CopyButton value={address} />
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="rounded p-1 text-muted-foreground hover:text-secondary" aria-label="View on Etherscan">
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </span>
  );
}

export function TxHashLink({ hash, className }: { hash: string; className?: string }) {
  const url = txExplorerUrl(hash);
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="mono text-xs text-secondary hover:underline" title={hash}>
          {shortHash(hash)}
        </a>
      ) : (
        <span className="mono text-xs text-ink" title={`${hash} (local network – no public explorer)`}>
          {shortHash(hash)}
        </span>
      )}
      <CopyButton value={hash} />
      {url && <ExternalLink className="h-3 w-3 text-muted-foreground" />}
    </span>
  );
}

/* ---------------------------------------------------------------- Badges */
const STAGE_VARIANT: Record<StageName, "default" | "info" | "warning" | "danger" | "muted" | "violet" | "solid"> = {
  HARVESTED: "muted",
  REGISTERED: "default",
  IN_TRANSIT: "info",
  AT_WAREHOUSE: "violet",
  QUALITY_CHECKED: "violet",
  OUT_FOR_DELIVERY: "info",
  AT_RETAILER: "default",
  AVAILABLE_FOR_SALE: "solid",
  SOLD: "muted",
  RECALLED: "danger",
};
export const StageBadge = ({ stage }: { stage: StageName }) => <Badge variant={STAGE_VARIANT[stage]}>{STAGE_LABEL[stage]}</Badge>;

export function LifecycleBadge({ stage }: { stage: StageName }) {
  const l = lifecycle(stage);
  const v = l === "Recalled" ? "danger" : l === "Sold" ? "muted" : l === "Delivered" ? "solid" : "info";
  return <Badge variant={v}>{l}</Badge>;
}

export function VerificationBadge({ status }: { status: VerificationName }) {
  if (status === "Verified")
    return (
      <Badge>
        <BadgeCheck /> Verified
      </Badge>
    );
  if (status === "Pending")
    return (
      <Badge variant="warning">
        <Clock /> Pending verification
      </Badge>
    );
  if (status === "Rejected")
    return (
      <Badge variant="danger">
        <XCircle /> Rejected
      </Badge>
    );
  return (
    <Badge variant="danger">
      <ShieldAlert /> Revoked
    </Badge>
  );
}

/** Explicitly labels where a piece of information comes from. */
export function SourceBadge({ source }: { source: "chain" | "index" | "offchain" }) {
  if (source === "chain")
    return (
      <Badge title="Read directly from the FarmChain smart contracts">
        <ShieldCheck /> On-chain verified
      </Badge>
    );
  if (source === "index")
    return (
      <Badge variant="outline" title="From the backend search index (a cache of on-chain events). Not authoritative.">
        <Database /> Indexed (cache)
      </Badge>
    );
  return (
    <Badge variant="warning" title="Supplied by a participant and stored on IPFS. The blockchain only stores its content hash; it cannot verify the claims inside.">
      <FileText /> Off-chain document
    </Badge>
  );
}

/* ---------------------------------------------------------------- Transaction status */
const TX_STEPS: { phase: TxState["phase"]; label: string }[] = [
  { phase: "awaiting_wallet", label: "Waiting for wallet confirmation" },
  { phase: "submitted", label: "Transaction submitted" },
  { phase: "pending", label: "Pending on-chain" },
  { phase: "confirmed", label: "Confirmed" },
];

export function TxStatusPanel({ state, className }: { state: TxState; className?: string }) {
  if (state.phase === "idle") return null;
  const order = ["awaiting_wallet", "submitted", "pending", "confirmed"];
  const current = state.phase === "failed" ? order.indexOf(state.hash ? "pending" : "awaiting_wallet") : order.indexOf(state.phase);
  return (
    <div className={cn("rounded-lg border bg-slate-50/70 p-4", className)} aria-live="polite" data-testid="tx-status">
      {state.label && <p className="mb-3 text-sm font-medium text-ink">{state.label}</p>}
      <ol className="space-y-2">
        {TX_STEPS.map((s, i) => {
          const done = state.phase === "confirmed" ? true : i < current;
          const active = i === current && state.phase !== "failed" && state.phase !== "confirmed";
          const failed = state.phase === "failed" && i === current;
          return (
            <li key={s.phase} className="flex items-center gap-2 text-sm">
              {failed ? (
                <XCircle className="h-4 w-4 text-destructive" />
              ) : done ? (
                <CheckCircle2 className="h-4 w-4 text-secondary" />
              ) : active ? (
                <Loader2 className="h-4 w-4 animate-spin text-secondary" />
              ) : (
                <Circle className="h-4 w-4 text-slate-300" />
              )}
              <span className={cn(done || active ? "text-ink" : "text-muted-foreground", failed && "text-destructive")}>{failed ? (state.rejected ? "Rejected in wallet" : "Transaction failed") : s.label}</span>
            </li>
          );
        })}
      </ol>
      {state.hash && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
          Tx hash: <TxHashLink hash={state.hash} />
        </div>
      )}
      {state.error && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-md bg-red-50 p-2 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {state.error}
        </p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- States */
export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed bg-white px-6 py-12 text-center", className)}>
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-accent text-forest">{icon ?? <Inbox className="h-5 w-5" />}</div>
      <p className="font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", message, onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center rounded-xl border border-red-200 bg-red-50/60 px-6 py-10 text-center">
      <AlertTriangle className="mb-2 h-6 w-6 text-destructive" />
      <p className="font-semibold text-ink">{title}</p>
      {message && <p className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function StatCard({ label, value, icon, hint, accent = "forest" }: { label: string; value: ReactNode; icon: ReactNode; hint?: string; accent?: "forest" | "sky" | "amber" | "violet" | "slate" }) {
  const tone = {
    forest: "bg-accent text-forest",
    sky: "bg-sky-50 text-sky-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
    slate: "bg-slate-100 text-slate-700",
  }[accent];
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-ink">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-lg [&_svg]:h-5 [&_svg]:w-5", tone)}>{icon}</div>
      </div>
    </Card>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: string; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <div className="mb-1">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function NetworkPill({ chainId }: { chainId: number | null }) {
  const ok = chainId === NETWORK.chainId;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", ok ? "bg-accent text-forest" : "bg-amber-50 text-amber-700")}>
      <span className={cn("h-1.5 w-1.5 rounded-full", ok ? "bg-secondary" : "bg-warn")} />
      {ok ? NETWORK.name : "Wrong network"}
    </span>
  );
}

export const WalletIcon = Wallet;
export const ChainIcon = Link2;
