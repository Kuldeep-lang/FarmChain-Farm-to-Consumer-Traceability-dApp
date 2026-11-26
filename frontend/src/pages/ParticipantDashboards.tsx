import { useMemo, type ReactNode } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Boxes, CheckCircle2, ClipboardCheck, Inbox, PackageCheck, Scale, ShoppingBag, Store, Truck, Warehouse } from "lucide-react";
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, Badge } from "@/components/ui/primitives";
import { EmptyState, ErrorState, PageHeader, SourceBadge, StatCard } from "@/components/common";
import { BatchTable } from "@/components/BatchTable";
import { RecentTransactions } from "@/components/RecentTransactions";
import { useMyBatches, useParticipantNames } from "@/hooks/useBatches";
import { useParticipant } from "@/hooks/useParticipant";
import type { BatchWithPending } from "@/blockchain/reads";
import type { RoleName, StageName } from "@/blockchain/enums";
import { formatNumber } from "@/utils/format";

interface Section {
  key: string;
  label: string;
  icon: ReactNode;
  filter: (b: BatchWithPending, me: string) => boolean;
  empty: string;
}

interface Config {
  role: RoleName;
  title: string;
  description: string;
  sections: Section[];
  stats: (list: BatchWithPending[], me: string) => { label: string; value: ReactNode; icon: ReactNode; accent?: "forest" | "sky" | "amber" | "violet" | "slate"; hint?: string }[];
}

const lc = (a: string) => a.toLowerCase();
const owns = (b: BatchWithPending, me: string) => lc(b.currentOwner) === lc(me);
const incoming = (b: BatchWithPending, me: string) => Boolean(b.pending && lc(b.pending.to) === lc(me));
const outgoing = (b: BatchWithPending, me: string) => Boolean(b.pending && lc(b.pending.from) === lc(me));
const handedOver = (b: BatchWithPending, me: string) => !owns(b, me) && !incoming(b, me);
const inStage = (...s: StageName[]) => (b: BatchWithPending) => s.includes(b.status);
const qtySummary = (list: BatchWithPending[]) => {
  const m = new Map<string, number>();
  list.forEach((b) => m.set(b.unit, (m.get(b.unit) ?? 0) + b.quantity));
  return [...m.entries()].map(([u, q]) => `${formatNumber(q)} ${u}`).join(" · ") || "0";
};

const CONFIGS: Record<"Distributor" | "Warehouse" | "Retailer", Config> = {
  Distributor: {
    role: "Distributor",
    title: "Distributor dashboard",
    description: "Accept produce from farmers, record shipments and hand over to warehouses or retailers.",
    sections: [
      { key: "incoming", label: "Incoming", icon: <Inbox />, filter: incoming, empty: "No batches are waiting for your acceptance." },
      { key: "accepted", label: "Accepted", icon: <PackageCheck />, filter: (b, me) => owns(b, me) && !inStage("IN_TRANSIT", "OUT_FOR_DELIVERY")(b), empty: "No accepted batches awaiting dispatch." },
      { key: "transit", label: "In transit", icon: <Truck />, filter: (b, me) => owns(b, me) && inStage("IN_TRANSIT", "OUT_FOR_DELIVERY")(b), empty: "Nothing in transit." },
      { key: "delivered", label: "Completed deliveries", icon: <CheckCircle2 />, filter: handedOver, empty: "No completed deliveries yet." },
    ],
    stats: (l, me) => [
      { label: "Incoming batches", value: l.filter((b) => incoming(b, me)).length, icon: <Inbox />, accent: "amber" },
      { label: "Accepted batches", value: l.filter((b) => owns(b, me)).length, icon: <PackageCheck /> },
      { label: "In transit", value: l.filter((b) => owns(b, me) && inStage("IN_TRANSIT", "OUT_FOR_DELIVERY")(b)).length, icon: <Truck />, accent: "sky" },
      { label: "Completed deliveries", value: l.filter((b) => handedOver(b, me)).length, icon: <CheckCircle2 />, accent: "violet" },
      { label: "Total transported", value: <span className="text-lg">{qtySummary(l.filter((b) => !incoming(b, me)))}</span>, icon: <Scale />, accent: "slate" },
    ],
  },
  Warehouse: {
    role: "Warehouse",
    title: "Warehouse dashboard",
    description: "Receive produce, record storage conditions and quality inspections, and dispatch to retailers.",
    sections: [
      { key: "incoming", label: "Incoming produce", icon: <ArrowDownToLine />, filter: incoming, empty: "No incoming batches." },
      { key: "arrival", label: "Awaiting arrival", icon: <Warehouse />, filter: (b, me) => owns(b, me) && !b.pending && !inStage("AT_WAREHOUSE", "QUALITY_CHECKED", "OUT_FOR_DELIVERY")(b), empty: "No accepted batches awaiting arrival confirmation." },
      { key: "stored", label: "Stored", icon: <Boxes />, filter: (b, me) => owns(b, me) && inStage("AT_WAREHOUSE", "QUALITY_CHECKED", "OUT_FOR_DELIVERY")(b), empty: "Nothing in storage." },
      { key: "outgoing", label: "Outgoing", icon: <ArrowUpFromLine />, filter: (b, me) => outgoing(b, me) || handedOver(b, me), empty: "No outgoing batches." },
    ],
    stats: (l, me) => [
      { label: "Incoming produce", value: l.filter((b) => incoming(b, me)).length, icon: <ArrowDownToLine />, accent: "amber" },
      { label: "Stored batches", value: l.filter((b) => owns(b, me) && inStage("AT_WAREHOUSE", "QUALITY_CHECKED", "OUT_FOR_DELIVERY")(b)).length, icon: <Boxes /> },
      { label: "Quality checked", value: l.filter((b) => owns(b, me) && b.status === "QUALITY_CHECKED").length, icon: <ClipboardCheck />, accent: "violet" },
      { label: "Outgoing / dispatched", value: l.filter((b) => outgoing(b, me) || handedOver(b, me)).length, icon: <ArrowUpFromLine />, accent: "sky" },
    ],
  },
  Retailer: {
    role: "Retailer",
    title: "Retailer dashboard",
    description: "Confirm deliveries, put produce on sale, and give consumers a verifiable QR code.",
    sections: [
      { key: "incoming", label: "Incoming products", icon: <Inbox />, filter: incoming, empty: "No deliveries awaiting acceptance." },
      { key: "accepted", label: "Accepted deliveries", icon: <PackageCheck />, filter: (b, me) => owns(b, me) && !inStage("AVAILABLE_FOR_SALE", "SOLD")(b), empty: "No accepted deliveries pending shelf placement." },
      { key: "available", label: "Available for sale", icon: <ShoppingBag />, filter: (b, me) => owns(b, me) && b.status === "AVAILABLE_FOR_SALE", empty: "Nothing on sale yet." },
      { key: "sold", label: "Sold / recalled", icon: <Store />, filter: (b, me) => owns(b, me) && inStage("SOLD", "RECALLED")(b), empty: "No sold batches." },
    ],
    stats: (l, me) => [
      { label: "Incoming products", value: l.filter((b) => incoming(b, me)).length, icon: <Inbox />, accent: "amber" },
      { label: "Accepted deliveries", value: l.filter((b) => owns(b, me)).length, icon: <PackageCheck /> },
      { label: "Available batches", value: l.filter((b) => owns(b, me) && b.status === "AVAILABLE_FOR_SALE").length, icon: <ShoppingBag />, accent: "violet" },
      { label: "Total received quantity", value: <span className="text-lg">{qtySummary(l.filter((b) => owns(b, me)))}</span>, icon: <Scale />, accent: "slate" },
    ],
  },
};

function ParticipantDashboard({ config }: { config: Config }) {
  const { account, isAdmin, role } = useParticipant();
  const q = useMyBatches("participant");
  const names = useParticipantNames();
  const me = account ?? "";
  const list = useMemo(() => q.data ?? [], [q.data]);
  const stats = config.stats(list, me);

  return (
    <div className="space-y-6">
      <PageHeader title={config.title} description={config.description} eyebrow={<SourceBadge source="chain" />} />
      {q.isError ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className={`grid gap-4 sm:grid-cols-2 ${stats.length > 4 ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>
            {q.isLoading ? Array.from({ length: stats.length }).map((_, i) => <Skeleton key={i} className="h-[104px]" />) : stats.map((s) => <StatCard key={s.label} {...s} />)}
          </div>
          <Tabs defaultValue={config.sections[0].key}>
            <TabsList>
              {config.sections.map((s) => {
                const n = list.filter((b) => s.filter(b, me)).length;
                return (
                  <TabsTrigger key={s.key} value={s.key} className="[&_svg]:h-4 [&_svg]:w-4">
                    {s.icon} {s.label}
                    {n > 0 && <Badge variant={s.key === "incoming" ? "warning" : "muted"} className="ml-1 px-1.5">{n}</Badge>}
                  </TabsTrigger>
                );
              })}
            </TabsList>
            {config.sections.map((s) => (
              <TabsContent key={s.key} value={s.key}>
                {q.isLoading ? <Skeleton className="h-64" /> : (
                  <BatchTable batches={list.filter((b) => s.filter(b, me))} role={role} isAdmin={isAdmin} me={account} names={names.data?.names} empty={<EmptyState title={s.label} description={s.empty} />} />
                )}
              </TabsContent>
            ))}
          </Tabs>
          <RecentTransactions />
        </>
      )}
    </div>
  );
}

export const DistributorDashboard = () => <ParticipantDashboard config={CONFIGS.Distributor} />;
export const WarehouseDashboard = () => <ParticipantDashboard config={CONFIGS.Warehouse} />;
export const RetailerDashboard = () => <ParticipantDashboard config={CONFIGS.Retailer} />;
