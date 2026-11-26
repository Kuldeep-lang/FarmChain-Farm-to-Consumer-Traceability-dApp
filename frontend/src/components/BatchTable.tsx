import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Eye, History, QrCode, Search } from "lucide-react";
import { Button } from "./ui/button";
import { Badge, Input, Table, TBody, TD, TH, THead, TR } from "./ui/primitives";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { AddressDisplay, EmptyState, StageBadge } from "./common";
import { QRCodeCard } from "./QRCodeCard";
import { BatchActions } from "./BatchActions";
import type { BatchWithPending } from "@/blockchain/reads";
import type { RoleName } from "@/blockchain/enums";
import { formatBatchId, formatDate, formatNumber, shortAddress } from "@/utils/format";

const PAGE_SIZE = 8;

/** Searchable, paginated batch table with QR / history / role-specific on-chain actions. */
export function BatchTable({
  batches,
  role,
  isAdmin,
  me,
  empty,
  showOwner = true,
  showActions = true,
  names = {},
}: {
  batches: BatchWithPending[];
  role: RoleName;
  isAdmin: boolean;
  me?: string | null;
  empty?: ReactNode;
  showOwner?: boolean;
  showActions?: boolean;
  names?: Record<string, string>;
}) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [qr, setQr] = useState<BatchWithPending | null>(null);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return batches;
    return batches.filter((b) =>
      [formatBatchId(b.id), String(b.id), b.productName, b.category, b.farmLocation, b.status, b.currentOwner].some((v) => v.toLowerCase().includes(s)),
    );
  }, [batches, q]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  if (!batches.length) return <>{empty ?? <EmptyState title="No batches" />}</>;

  return (
    <div className="rounded-xl border bg-white shadow-card">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search batches…" className="pl-9" aria-label="Search batches" />
        </div>
        <p className="text-xs text-muted-foreground">{filtered.length} batch{filtered.length === 1 ? "" : "es"} · read from blockchain</p>
      </div>
      <Table>
        <THead>
          <TR>
            <TH>Batch</TH>
            <TH>Product</TH>
            <TH>Quantity</TH>
            <TH>Harvested</TH>
            {showOwner && <TH>Current owner</TH>}
            <TH>Stage</TH>
            <TH>Registered</TH>
            <TH className="text-right">Actions</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((b) => (
            <TR key={b.id}>
              <TD className="mono whitespace-nowrap text-xs font-semibold text-ink">{formatBatchId(b.id)}</TD>
              <TD>
                <p className="font-medium text-ink">{b.productName}</p>
                <p className="text-xs text-muted-foreground">{b.category}</p>
              </TD>
              <TD className="whitespace-nowrap tabular-nums">{formatNumber(b.quantity)} {b.unit}</TD>
              <TD className="whitespace-nowrap">{formatDate(b.harvestDate)}</TD>
              {showOwner && (
                <TD>
                  {me && b.currentOwner.toLowerCase() === me.toLowerCase() ? <Badge variant="outline">You</Badge> : <AddressDisplay address={b.currentOwner} label={names[b.currentOwner.toLowerCase()] ?? null} />}
                </TD>
              )}
              <TD>
                <div className="flex flex-col items-start gap-1">
                  <StageBadge stage={b.status} />
                  {b.pending && (
                    <Badge variant="warning" title={`Pending transfer to ${b.pending.to}`}>
                      {me && b.pending.to.toLowerCase() === me.toLowerCase() ? "Awaiting your acceptance" : `Pending → ${shortAddress(b.pending.to)}`}
                    </Badge>
                  )}
                </div>
              </TD>
              <TD className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(b.createdAt)}</TD>
              <TD>
                <div className="flex flex-wrap items-center justify-end gap-1">
                  <Button size="icon" variant="ghost" asChild title="View details" aria-label={`View ${formatBatchId(b.id)}`}>
                    <Link to={`/batches/${b.id}`}><Eye /></Link>
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setQr(b)} title="QR code" aria-label={`QR code for ${formatBatchId(b.id)}`}>
                    <QrCode />
                  </Button>
                  <Button size="icon" variant="ghost" asChild title="Blockchain history" aria-label={`History of ${formatBatchId(b.id)}`}>
                    <Link to={`/trace/${b.id}`}><History /></Link>
                  </Button>
                  {showActions && <BatchActions batch={b} role={role} isAdmin={isAdmin} limit={2} />}
                </div>
              </TD>
            </TR>
          ))}
          {!rows.length && (
            <TR>
              <TD colSpan={8} className="py-10 text-center text-sm text-muted-foreground">No batches match “{q}”.</TD>
            </TR>
          )}
        </TBody>
      </Table>
      {pages > 1 && (
        <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
          <span className="text-muted-foreground">Page {current} of {pages}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={current === 1} onClick={() => setPage(current - 1)} aria-label="Previous page"><ChevronLeft /></Button>
            <Button size="sm" variant="outline" disabled={current === pages} onClick={() => setPage(current + 1)} aria-label="Next page"><ChevronRight /></Button>
          </div>
        </div>
      )}
      <Dialog open={Boolean(qr)} onOpenChange={(o) => !o && setQr(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>QR code · {qr && formatBatchId(qr.id)}</DialogTitle>
            <DialogDescription>Links to the public traceability page. Contains no private data.</DialogDescription>
          </DialogHeader>
          {qr && <QRCodeCard batchId={qr.id} productName={qr.productName} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
