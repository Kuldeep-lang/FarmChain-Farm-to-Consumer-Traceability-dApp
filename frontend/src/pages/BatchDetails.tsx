import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui/primitives";
import { AddressDisplay, ErrorState, PageHeader, SourceBadge, StageBadge } from "@/components/common";
import { QRCodeCard } from "@/components/QRCodeCard";
import { BatchActions } from "@/components/BatchActions";
import { BatchTimeline } from "@/components/BatchTimeline";
import { fetchBatch, fetchBatchHistory, fetchPendingTransfer } from "@/blockchain/reads";
import { useParticipant } from "@/hooks/useParticipant";
import { useParticipantNames } from "@/hooks/useBatches";
import { ipfsUrl } from "@/blockchain/config";
import { formatBatchId, formatDate, formatDateTime, formatNumber, parseBatchId } from "@/utils/format";

export function BatchDetails() {
  const { id: raw } = useParams();
  const id = parseBatchId(raw ?? "");
  const navigate = useNavigate();
  const { role, isAdmin } = useParticipant();
  const names = useParticipantNames();
  const batch = useQuery({
    queryKey: ["batch", id],
    queryFn: async () => {
      const [b, pending] = await Promise.all([fetchBatch(id!), fetchPendingTransfer(id!)]);
      return b ? { ...b, pending } : null;
    },
    enabled: id !== null,
  });
  const history = useQuery({ queryKey: ["history", id], queryFn: () => fetchBatchHistory(id!), enabled: id !== null });

  if (id === null) return <ErrorState title="Invalid batch ID" />;
  if (batch.isLoading) return <Skeleton className="h-96" />;
  if (batch.isError) return <ErrorState message={(batch.error as Error).message} onRetry={() => batch.refetch()} />;
  const b = batch.data;
  if (!b) return <ErrorState title={`Batch ${formatBatchId(id)} not found on-chain`} />;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate(-1)}><ArrowLeft /> Back</Button>
      <PageHeader
        title={`${b.productName} · ${formatBatchId(b.id)}`}
        description={`${formatNumber(b.quantity)} ${b.unit} of ${b.category.toLowerCase()} from ${b.farmLocation}`}
        eyebrow={<div className="flex gap-2"><SourceBadge source="chain" /><StageBadge stage={b.status} /></div>}
        actions={<Button variant="outline" asChild><Link to={`/trace/${b.id}`}><ExternalLink /> Public trace page</Link></Button>}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
            <CardContent>
              <BatchActions batch={b} role={role} isAdmin={isAdmin} size="default" onDone={() => { batch.refetch(); history.refetch(); }} />
              {b.pending && (
                <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                  Pending transfer from <AddressDisplay address={b.pending.from} label={names.data?.names[b.pending.from.toLowerCase()]} /> to <AddressDisplay address={b.pending.to} label={names.data?.names[b.pending.to.toLowerCase()]} /> since {formatDateTime(b.pending.createdAt)}.
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>On-chain history</CardTitle></CardHeader>
            <CardContent>
              {history.isLoading ? <Skeleton className="h-64" /> : history.isError ? <ErrorState message={(history.error as Error).message} /> : <BatchTimeline history={history.data ?? []} names={names.data?.names ?? {}} roles={names.data?.roles ?? {}} />}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Batch record</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <Row k="Farmer"><AddressDisplay address={b.farmer} label={names.data?.names[b.farmer.toLowerCase()]} /></Row>
                <Row k="Current owner"><AddressDisplay address={b.currentOwner} label={names.data?.names[b.currentOwner.toLowerCase()]} /></Row>
                <Row k="Harvest date">{formatDate(b.harvestDate)}</Row>
                <Row k="Registered">{formatDateTime(b.createdAt)}</Row>
                <Row k="Metadata">
                  {b.metadataCID ? <a href={ipfsUrl(b.metadataCID)} target="_blank" rel="noreferrer" className="mono break-all text-xs text-secondary hover:underline">{b.metadataCID}</a> : <span className="text-muted-foreground">None</span>}
                </Row>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>QR label</CardTitle></CardHeader>
            <CardContent><QRCodeCard batchId={b.id} productName={b.productName} compact /></CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}
