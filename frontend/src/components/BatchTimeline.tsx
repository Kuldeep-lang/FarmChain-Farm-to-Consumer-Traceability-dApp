import { CheckCircle2, FileText, MapPin, ShieldCheck, Sprout, Truck, Warehouse, Store, ClipboardCheck, PackageCheck, ShoppingBag, AlertOctagon, ArrowRightLeft, XCircle, Ban, PenLine, Link2 } from "lucide-react";
import type { ReactNode } from "react";
import type { HistoryEntry } from "@/blockchain/reads";
import { ACTION_LABEL, STAGE_LABEL, type ActionName } from "@/blockchain/enums";
import { ipfsUrl } from "@/blockchain/config";
import { formatDateTime } from "@/utils/format";
import { AddressDisplay, TxHashLink } from "./common";
import { cn } from "@/utils/cn";
import { Badge } from "./ui/primitives";

const ICON: Record<ActionName, ReactNode> = {
  Harvested: <Sprout />,
  Registered: <Link2 />,
  TransferInitiated: <ArrowRightLeft />,
  TransferAccepted: <PackageCheck />,
  TransferRejected: <XCircle />,
  TransferCancelled: <Ban />,
  ShipmentRecorded: <Truck />,
  WarehouseArrival: <Warehouse />,
  QualityInspectionPassed: <ClipboardCheck />,
  QualityInspectionFailed: <ClipboardCheck />,
  RetailArrival: <Store />,
  OutForDelivery: <Truck />,
  AvailableForSale: <ShoppingBag />,
  Sold: <CheckCircle2 />,
  Recalled: <AlertOctagon />,
  MetadataUpdated: <PenLine />,
};

const TONE: Partial<Record<ActionName, string>> = {
  TransferRejected: "bg-red-50 text-red-600 ring-red-200",
  TransferCancelled: "bg-slate-100 text-slate-600 ring-slate-200",
  QualityInspectionFailed: "bg-red-50 text-red-600 ring-red-200",
  Recalled: "bg-red-100 text-red-700 ring-red-300",
  Harvested: "bg-amber-50 text-amber-700 ring-amber-200",
};

/** Friendlier label for "custody accepted" depending on who accepted. */
function labelFor(e: HistoryEntry, roleOf: (a: string) => string | undefined) {
  if (e.action === "TransferAccepted") {
    const r = roleOf(e.newOwner);
    if (r === "Distributor") return "Collected by distributor";
    if (r === "Warehouse") return "Custody accepted by warehouse";
    if (r === "Retailer") return "Custody accepted by retailer";
  }
  return ACTION_LABEL[e.action];
}

export function BatchTimeline({ history, names, roles }: { history: HistoryEntry[]; names: Record<string, string>; roles: Record<string, string> }) {
  const nameOf = (a: string) => names[a.toLowerCase()];
  const roleOf = (a: string) => roles[a.toLowerCase()];
  return (
    <ol className="relative space-y-0" aria-label="Supply chain journey">
      {history.map((e, i) => {
        const last = i === history.length - 1;
        const tone = TONE[e.action] ?? "bg-accent text-forest ring-forest-100";
        const showParty = e.action === "TransferInitiated" || e.action === "TransferAccepted";
        return (
          <li key={e.index} className="relative flex gap-4 pb-6" data-testid="timeline-entry">
            {!last && <span className="absolute left-[19px] top-10 h-[calc(100%-2.5rem)] w-px bg-border" aria-hidden />}
            <div className={cn("relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full ring-4 ring-white [&_svg]:h-[18px] [&_svg]:w-[18px]", tone.split(" ").slice(0, 2).join(" "))}>{ICON[e.action]}</div>
            <div className="min-w-0 flex-1 rounded-xl border bg-white p-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-ink">{labelFor(e, roleOf)}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.action === "Harvested" ? "Harvest date declared by farmer · " : ""}
                    {formatDateTime(e.timestamp)} · Stage: {STAGE_LABEL[e.stage]}
                  </p>
                </div>
                {e.txHash ? (
                  <Badge title={e.txHashSource === "indexer" ? "History read on-chain; transaction hash resolved via the backend indexer" : "Recorded in a confirmed blockchain transaction"}>
                    <ShieldCheck /> Verified on-chain
                  </Badge>
                ) : (
                  <Badge variant="outline">
                    <ShieldCheck /> On-chain record
                  </Badge>
                )}
              </div>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                {e.location && (
                  <div className="flex items-start gap-1.5 sm:col-span-2">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-ink">{e.location}</span>
                  </div>
                )}
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Recorded by</dt>
                  <dd>
                    <AddressDisplay address={e.actor} label={nameOf(e.actor) ?? null} />
                    {roleOf(e.actor) && <span className="ml-1 text-xs text-muted-foreground">({roleOf(e.actor)})</span>}
                  </dd>
                </div>
                {showParty && (
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{e.action === "TransferInitiated" ? "Offered to" : "From"}</dt>
                    <dd>
                      <AddressDisplay address={e.action === "TransferInitiated" ? e.newOwner : e.previousOwner} label={nameOf(e.action === "TransferInitiated" ? e.newOwner : e.previousOwner) ?? null} />
                    </dd>
                  </div>
                )}
                {e.txHash && (
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Transaction{e.txHashSource === "indexer" ? " (via indexer)" : ""}</dt>
                    <dd>
                      <TxHashLink hash={e.txHash} />
                    </dd>
                  </div>
                )}
                {e.metadataCID && (
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Supporting document (off-chain, IPFS)</dt>
                    <dd>
                      <a href={ipfsUrl(e.metadataCID)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-secondary hover:underline">
                        <FileText className="h-3.5 w-3.5" /> <span className="mono">{e.metadataCID.slice(0, 14)}…</span>
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
