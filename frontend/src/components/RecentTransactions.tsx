import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "./ui/primitives";
import { EmptyState, SourceBadge, TxHashLink } from "./common";
import { useRecentTransactions } from "@/hooks/useBatches";
import { OPERATION_LABEL } from "@/blockchain/enums";
import { formatBatchId, timeAgo } from "@/utils/format";

export function RecentTransactions({ limit = 6 }: { limit?: number }) {
  const q = useRecentTransactions(limit);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Recent transactions</CardTitle>
        <div className="flex items-center gap-2">
          <SourceBadge source="index" />
          <Link to="/transactions" className="text-xs font-medium text-secondary hover:underline">View all</Link>
        </div>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : q.isError ? (
          <p className="text-sm text-muted-foreground">Transaction index unavailable (backend offline). On-chain data above is unaffected.</p>
        ) : !q.data?.items.length ? (
          <EmptyState title="No transactions yet" className="py-6" />
        ) : (
          <ul className="divide-y">
            {q.data.items.map((t) => (
              <li key={t.hash} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {OPERATION_LABEL[t.operation] ?? t.operation}
                    {t.batchId ? <span className="ml-1.5 text-xs text-muted-foreground">{formatBatchId(t.batchId)}</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">{timeAgo(t.timestamp)}</p>
                </div>
                <TxHashLink hash={t.hash} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
