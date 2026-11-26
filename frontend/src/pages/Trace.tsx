import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertOctagon, Calendar, CheckCircle2, Circle, ExternalLink, FileText, ImageOff, Info, MapPin, Package, ScanLine, ShieldCheck, Sprout, Tag, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui/primitives";
import { AddressDisplay, ErrorState, LifecycleBadge, SourceBadge, StageBadge, TxHashLink, VerificationBadge } from "@/components/common";
import { BatchTimeline } from "@/components/BatchTimeline";
import { QRCodeCard } from "@/components/QRCodeCard";
import { fetchBatch, fetchBatchHistory, fetchParticipant, type HistoryEntry, type Participant } from "@/blockchain/reads";
import { ipfsUrl, NETWORK, CONTRACTS_READY, ADDRESSES, addressExplorerUrl } from "@/blockchain/config";
import type { ActionName } from "@/blockchain/enums";
import { formatBatchId, formatDate, formatNumber, parseBatchId } from "@/utils/format";
import { cn } from "@/utils/cn";

interface BatchMetadata {
  description?: string;
  imageCID?: string | null;
  certificationCID?: string | null;
  state?: string;
  district?: string;
  additional?: Record<string, string>;
  batchId?: string;
}

/** Consumer-facing milestones (spec page 10). */
const MILESTONES: { label: string; actions: ActionName[]; match?: (e: HistoryEntry, roles: Record<string, string>) => boolean }[] = [
  { label: "Harvested", actions: ["Harvested"] },
  { label: "Registered on blockchain", actions: ["Registered"] },
  { label: "Collected by distributor", actions: ["TransferAccepted"], match: (e, r) => r[e.newOwner.toLowerCase()] === "Distributor" },
  { label: "In transit", actions: ["ShipmentRecorded", "OutForDelivery"] },
  { label: "Received at warehouse", actions: ["WarehouseArrival"] },
  { label: "Quality inspection", actions: ["QualityInspectionPassed", "QualityInspectionFailed"] },
  { label: "Received by retailer", actions: ["RetailArrival"] },
  { label: "Available for sale", actions: ["AvailableForSale"] },
];

export function Trace() {
  const { batchId: raw } = useParams();
  const id = parseBatchId(raw ?? "");

  const batch = useQuery({ queryKey: ["trace-batch", id], queryFn: () => fetchBatch(id!), enabled: id !== null && CONTRACTS_READY });
  const history = useQuery({ queryKey: ["trace-history", id], queryFn: () => fetchBatchHistory(id!), enabled: Boolean(batch.data) });

  const actors = useMemo(() => {
    const set = new Set<string>();
    if (batch.data) set.add(batch.data.farmer.toLowerCase());
    history.data?.forEach((h) => [h.actor, h.newOwner, h.previousOwner].forEach((a) => a && !/^0x0+$/.test(a) && set.add(a.toLowerCase())));
    return [...set].sort();
  }, [batch.data, history.data]);

  // Participant names & roles come from the UserRegistry contract (on-chain), not the backend.
  const participants = useQuery({
    queryKey: ["trace-participants", actors.join(",")],
    queryFn: async () => {
      const list = await Promise.all(actors.map((a) => fetchParticipant(a).catch(() => null)));
      const map: Record<string, Participant> = {};
      list.forEach((p, i) => p && (map[actors[i]] = p));
      return map;
    },
    enabled: actors.length > 0,
  });

  const metadata = useQuery({
    queryKey: ["trace-metadata", batch.data?.metadataCID],
    queryFn: async (): Promise<BatchMetadata> => {
      const res = await fetch(ipfsUrl(batch.data!.metadataCID));
      if (!res.ok) throw new Error(`IPFS gateway returned ${res.status}`);
      return res.json();
    },
    enabled: Boolean(batch.data?.metadataCID),
    retry: 1,
    staleTime: Infinity,
  });

  if (!CONTRACTS_READY) return <div className="container py-16"><ErrorState title="Contracts not configured" message="This deployment of FarmChain has no contract addresses for its network." /></div>;
  if (id === null) return <div className="container py-16"><ErrorState title="Invalid batch ID" message="Batch IDs look like FC-10001." /></div>;
  if (batch.isLoading) return <TraceSkeleton />;
  if (batch.isError) return <div className="container py-16"><ErrorState title="Could not reach the blockchain" message={(batch.error as Error).message} onRetry={() => batch.refetch()} /></div>;
  const b = batch.data;
  if (!b) {
    return (
      <div className="container py-16">
        <ErrorState title={`Batch ${formatBatchId(id)} was not found on-chain`} message="Check the batch ID or scan the QR code again. Only batches registered in the FarmChain ProductRegistry contract can be traced." />
        <div className="mt-4 text-center"><Button asChild variant="outline"><Link to="/scan"><ScanLine /> Scan another product</Link></Button></div>
      </div>
    );
  }

  const p = participants.data ?? {};
  const names = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.name]));
  const roles = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.role]));
  const farmer = p[b.farmer.toLowerCase()];
  const md = metadata.data;
  const reached = (m: (typeof MILESTONES)[number]) => history.data?.find((e) => m.actions.includes(e.action) && (!m.match || m.match(e, roles)));

  return (
    <div className="bg-background pb-16">
      {b.status === "RECALLED" && (
        <div role="alert" className="bg-red-600 text-white">
          <div className="container flex items-center gap-3 py-3 text-sm font-medium">
            <AlertOctagon className="h-5 w-5 shrink-0" /> This batch has been RECALLED. Do not consume. See the recall record in the journey below.
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- header */}
      <section className="border-b bg-white">
        <div className="container grid gap-8 py-10 lg:grid-cols-[1fr_auto]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <SourceBadge source="chain" />
              <LifecycleBadge stage={b.status} />
              <StageBadge stage={b.status} />
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">{b.productName}</h1>
            <p className="mono mt-1 text-sm text-muted-foreground">{formatBatchId(b.id)}</p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Fact icon={<Tag />} label="Crop category" value={b.category} />
              <Fact icon={<Package />} label="Quantity" value={`${formatNumber(b.quantity)} ${b.unit}`} />
              <Fact icon={<Calendar />} label="Harvest date" value={formatDate(b.harvestDate)} note="Declared by farmer" />
              <Fact icon={<MapPin />} label="Farm location" value={b.farmLocation} />
            </div>
          </div>
          <div className="hidden lg:block"><QRCodeCard batchId={b.id} productName={b.productName} compact /></div>
        </div>
      </section>

      <div className="container mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {/* ---------------------------------------------- milestone stepper */}
          <Card>
            <CardHeader><CardTitle>Journey at a glance</CardTitle></CardHeader>
            <CardContent>
              {history.isLoading ? <Skeleton className="h-16" /> : (
                <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {MILESTONES.map((m) => {
                    const hit = reached(m);
                    const failed = hit?.action === "QualityInspectionFailed";
                    return (
                      <li key={m.label} className={cn("flex items-start gap-2 rounded-lg border p-3", hit ? (failed ? "border-red-200 bg-red-50" : "border-forest-100 bg-forest-50") : "bg-slate-50/60")}>
                        {hit ? <CheckCircle2 className={cn("mt-0.5 h-4 w-4 shrink-0", failed ? "text-red-600" : "text-secondary")} /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />}
                        <div>
                          <p className={cn("text-xs font-medium", hit ? "text-ink" : "text-muted-foreground")}>{m.label}{failed ? " (failed)" : ""}</p>
                          <p className="text-[11px] text-muted-foreground">{hit ? formatDate(hit.timestamp) : "Not yet"}</p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>

          {/* ---------------------------------------------- timeline */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Supply chain journey</CardTitle>
              <SourceBadge source="chain" />
            </CardHeader>
            <CardContent>
              {history.isLoading ? (
                <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
              ) : history.isError ? (
                <ErrorState message={(history.error as Error).message} onRetry={() => history.refetch()} />
              ) : (
                <BatchTimeline history={history.data ?? []} names={names} roles={roles} />
              )}
              <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {NETWORK.explorer
                  ? "Every transaction link opens Sepolia Etherscan so you can verify the record independently."
                  : "This is a local development network, so there is no public block explorer. Transaction hashes are shown for reference."}
              </p>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-6">
          {/* ---------------------------------------------- farmer */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2"><Sprout className="h-4 w-4 text-secondary" /> Farmer</CardTitle>
              <SourceBadge source="chain" />
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {participants.isLoading ? <Skeleton className="h-24" /> : farmer ? (
                <>
                  <div className="flex items-center gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-accent text-forest"><UserRound className="h-5 w-5" /></div>
                    <div>
                      <p className="font-semibold text-ink">{farmer.name}</p>
                      <p className="text-xs text-muted-foreground">{farmer.organization}</p>
                    </div>
                  </div>
                  <VerificationBadge status={farmer.verification} />
                  <dl className="space-y-2">
                    <div><dt className="text-xs text-muted-foreground">Farm location</dt><dd className="text-ink">{farmer.location}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Registered on FarmChain</dt><dd className="text-ink">{formatDate(farmer.registeredAt)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Wallet</dt><dd><AddressDisplay address={b.farmer} /></dd></div>
                  </dl>
                </>
              ) : (
                <AddressDisplay address={b.farmer} />
              )}
              <p className="text-xs text-muted-foreground">Verified means an administrator approved this participant on-chain. It does not certify farming practices.</p>
            </CardContent>
          </Card>

          {/* ---------------------------------------------- off-chain docs */}
          <Card className="border-amber-200">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4 text-amber-600" /> Supporting documents</CardTitle>
              <SourceBadge source="offchain" />
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-xs text-muted-foreground">Supplied by the farmer and stored on IPFS. The blockchain stores the document's content identifier (CID), proving it has not changed since registration, but it cannot verify the claims inside.</p>
              {!b.metadataCID ? (
                <p className="rounded-lg bg-slate-50 p-3 text-muted-foreground">No off-chain metadata was attached to this batch.</p>
              ) : metadata.isLoading ? (
                <Skeleton className="h-40" />
              ) : metadata.isError ? (
                <p className="rounded-lg bg-slate-50 p-3 text-muted-foreground">Could not load metadata from the IPFS gateway right now.</p>
              ) : md ? (
                <>
                  {md.imageCID ? (
                    <img src={ipfsUrl(md.imageCID)} alt={`${b.productName} photograph`} className="aspect-video w-full rounded-lg border object-cover" loading="lazy" />
                  ) : (
                    <div className="grid aspect-video place-items-center rounded-lg border bg-slate-50 text-muted-foreground"><ImageOff className="h-6 w-6" /></div>
                  )}
                  {md.description && <p className="text-ink">{md.description}</p>}
                  {md.additional && Object.keys(md.additional).length > 0 && (
                    <dl className="grid grid-cols-2 gap-2">
                      {Object.entries(md.additional).map(([k, v]) => <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="text-ink">{v}</dd></div>)}
                    </dl>
                  )}
                  {md.certificationCID && (
                    <a href={ipfsUrl(md.certificationCID)} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border p-3 hover:bg-muted">
                      <FileText className="h-4 w-4 text-amber-600" /> Certification document <ExternalLink className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                    </a>
                  )}
                  {md.batchId && md.batchId !== formatBatchId(b.id) && (
                    <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">Warning: metadata batch ID ({md.batchId}) does not match the on-chain ID.</p>
                  )}
                </>
              ) : null}
              {b.metadataCID && (
                <a href={ipfsUrl(b.metadataCID)} target="_blank" rel="noreferrer" className="mono block break-all text-xs text-secondary hover:underline">ipfs://{b.metadataCID}</a>
              )}
            </CardContent>
          </Card>

          {/* ---------------------------------------------- verification panel */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-secondary" /> How to verify</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p>This page reads directly from the FarmChain smart contracts on <strong className="text-ink">{NETWORK.name}</strong> through a public RPC. No FarmChain server is trusted for these records.</p>
              <ul className="space-y-1">
                <li className="flex items-center justify-between gap-2">ProductRegistry {addressExplorerUrl(ADDRESSES.ProductRegistry) ? <a className="mono text-secondary hover:underline" href={addressExplorerUrl(ADDRESSES.ProductRegistry)!} target="_blank" rel="noreferrer">{ADDRESSES.ProductRegistry.slice(0, 10)}…</a> : <span className="mono">{ADDRESSES.ProductRegistry.slice(0, 10)}…</span>}</li>
                <li className="flex items-center justify-between gap-2">SupplyChainTracker {addressExplorerUrl(ADDRESSES.SupplyChainTracker) ? <a className="mono text-secondary hover:underline" href={addressExplorerUrl(ADDRESSES.SupplyChainTracker)!} target="_blank" rel="noreferrer">{ADDRESSES.SupplyChainTracker.slice(0, 10)}…</a> : <span className="mono">{ADDRESSES.SupplyChainTracker.slice(0, 10)}…</span>}</li>
              </ul>
              {history.data?.[1]?.txHash && <p className="flex flex-wrap items-center gap-1">Registration tx: <TxHashLink hash={history.data[1].txHash} /></p>}
            </CardContent>
          </Card>
          <div className="lg:hidden"><QRCodeCard batchId={b.id} productName={b.productName} compact /></div>
        </aside>
      </div>
    </div>
  );
}

function Fact({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border bg-slate-50/60 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">{icon} {label}</div>
      <p className="mt-1 font-semibold text-ink">{value}</p>
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

function TraceSkeleton() {
  return (
    <div className="container space-y-6 py-10" aria-busy="true" aria-label="Loading batch from blockchain">
      <Skeleton className="h-8 w-72" />
      <div className="grid gap-4 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      <Skeleton className="h-96" />
    </div>
  );
}
