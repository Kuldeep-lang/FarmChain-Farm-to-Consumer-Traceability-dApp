import { useMemo } from "react";
import { Link } from "react-router-dom";
import { formatUnits } from "ethers";
import { Boxes, CheckCircle2, Coins, PackageOpen, PlusCircle, Scale, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui/primitives";
import { EmptyState, ErrorState, PageHeader, SourceBadge, StageBadge, StatCard } from "@/components/common";
import { SimpleBarChart } from "@/components/charts";
import { BatchTable } from "@/components/BatchTable";
import { RecentTransactions } from "@/components/RecentTransactions";
import { useMyBatches, useMyOrders, useParticipantNames } from "@/hooks/useBatches";
import { useParticipant } from "@/hooks/useParticipant";
import { STAGE_LABEL, lifecycle } from "@/blockchain/enums";
import { formatBatchId, formatNumber } from "@/utils/format";

export function FarmerDashboard() {
  const { account, isAdmin, participant } = useParticipant();
  const batches = useMyBatches("farmer");
  const orders = useMyOrders();
  const names = useParticipantNames();
  const list = batches.data ?? [];

  const stats = useMemo(() => {
    const qtyByUnit = new Map<string, number>();
    list.forEach((b) => qtyByUnit.set(b.unit, (qtyByUnit.get(b.unit) ?? 0) + b.quantity));
    const sales = (orders.data ?? []).filter((o) => o.status === "Released" && o.seller.toLowerCase() === account?.toLowerCase()).reduce((s, o) => s + o.amount, 0n);
    return {
      total: list.length,
      qty: [...qtyByUnit.entries()].map(([u, q]) => `${formatNumber(q)} ${u}`).join(" · ") || "0",
      active: list.filter((b) => lifecycle(b.status) === "Active").length,
      transit: list.filter((b) => b.status === "IN_TRANSIT" || b.status === "OUT_FOR_DELIVERY").length,
      delivered: list.filter((b) => ["AT_RETAILER", "AVAILABLE_FOR_SALE", "SOLD"].includes(b.status)).length,
      sales,
    };
  }, [list, orders.data, account]);

  const monthly = useMemo(() => {
    const months: { label: string; value: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ label: d.toLocaleString("en-IN", { month: "short" }), value: 0 });
    }
    list.forEach((b) => {
      const diff = (now.getFullYear() - b.harvestDate.getFullYear()) * 12 + now.getMonth() - b.harvestDate.getMonth();
      if (diff >= 0 && diff < 6) months[5 - diff].value += 1;
    });
    return months;
  }, [list]);

  const crops = useMemo(() => {
    const m = new Map<string, number>();
    list.forEach((b) => m.set(b.category, (m.get(b.category) ?? 0) + 1));
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [list]);

  const movement = useMemo(() => {
    const m = new Map<string, number>();
    list.forEach((b) => m.set(STAGE_LABEL[b.status], (m.get(STAGE_LABEL[b.status]) ?? 0) + 1));
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [list]);

  const inventory = list.filter((b) => b.currentOwner.toLowerCase() === account?.toLowerCase() && b.status !== "RECALLED");

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back${participant ? `, ${participant.name.split(" ")[0]}` : ""}`}
        description="Your farm's batches, read live from the ProductRegistry and SupplyChainTracker contracts."
        eyebrow={<SourceBadge source="chain" />}
        actions={
          <Button size="lg" asChild>
            <Link to="/batches/new"><PlusCircle /> Register New Batch</Link>
          </Button>
        }
      />

      {batches.isError ? (
        <ErrorState message={(batches.error as Error).message} onRetry={() => batches.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {batches.isLoading ? (
              Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[104px]" />)
            ) : (
              <>
                <StatCard label="Total batches registered" value={stats.total} icon={<Boxes />} />
                <StatCard label="Total quantity produced" value={<span className="text-lg">{stats.qty}</span>} icon={<Scale />} accent="slate" />
                <StatCard label="Active batches" value={stats.active} icon={<PackageOpen />} accent="violet" hint="Not yet at retail" />
                <StatCard label="Products in transit" value={stats.transit} icon={<Truck />} accent="sky" />
                <StatCard label="Completed deliveries" value={stats.delivered} icon={<CheckCircle2 />} hint="Reached a retailer" />
                <StatCard label="Total sales (escrow)" value={`${formatNumber(Number(formatUnits(stats.sales, 18)))} fUSD`} icon={<Coins />} accent="amber" hint="Released escrow payments · test token" />
              </>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <SimpleBarChart title="Monthly production" description="Batches by harvest month (last 6 months)" data={monthly} unit="batches" />
            <SimpleBarChart title="Crop distribution" description="Batches per crop category" data={crops} unit="batches" horizontal />
            <SimpleBarChart title="Batch movement status" description="Current on-chain stage" data={movement} unit="batches" horizontal />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>Recent batches</CardTitle></CardHeader>
              <CardContent>
                {list.length ? (
                  <ul className="divide-y">
                    {list.slice(0, 5).map((b) => (
                      <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                        <Link to={`/batches/${b.id}`} className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink hover:text-secondary">{b.productName}</p>
                          <p className="text-xs text-muted-foreground">{formatBatchId(b.id)} · {formatNumber(b.quantity)} {b.unit}</p>
                        </Link>
                        <StageBadge stage={b.status} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="No batches yet" description="Register your first harvest to create its on-chain identity." action={<Button asChild><Link to="/batches/new">Register batch</Link></Button>} className="py-8" />
                )}
              </CardContent>
            </Card>
            <RecentTransactions limit={5} />
          </div>

          <div>
            <h2 className="mb-3 text-lg font-semibold text-ink">Product inventory <span className="text-sm font-normal text-muted-foreground">(batches still with you)</span></h2>
            <BatchTable batches={inventory} role="Farmer" isAdmin={isAdmin} me={account} showOwner={false} names={names.data?.names} empty={<EmptyState title="No batches in inventory" description="All your batches have moved on, or you haven't registered any yet." />} />
          </div>
        </>
      )}
    </div>
  );
}
