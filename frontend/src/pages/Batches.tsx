import { Link } from "react-router-dom";
import { PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { EmptyState, ErrorState, PageHeader, SourceBadge } from "@/components/common";
import { BatchTable } from "@/components/BatchTable";
import { useMyBatches, useParticipantNames } from "@/hooks/useBatches";
import { useParticipant } from "@/hooks/useParticipant";

export function Batches() {
  const { account, isAdmin } = useParticipant();
  const q = useMyBatches("farmer");
  const names = useParticipantNames();
  return (
    <div>
      <PageHeader
        title="Batch management"
        description="Every batch you registered, with its current owner and stage from the blockchain."
        eyebrow={<SourceBadge source="chain" />}
        actions={<Button asChild><Link to="/batches/new"><PlusCircle /> Register new batch</Link></Button>}
      />
      {q.isLoading ? (
        <Skeleton className="h-96" />
      ) : q.isError ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
      ) : (
        <BatchTable
          batches={q.data ?? []}
          role="Farmer"
          isAdmin={isAdmin}
          me={account}
          names={names.data?.names}
          empty={<EmptyState title="No batches yet" description="Register your first harvest batch." action={<Button asChild><Link to="/batches/new">Register batch</Link></Button>} />}
        />
      )}
    </div>
  );
}
