import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, ChevronRight, Filter, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Label, NativeSelect, Skeleton, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { AddressDisplay, EmptyState, ErrorState, PageHeader, SourceBadge, TxHashLink } from "@/components/common";
import { api, type IndexedTransaction } from "@/services/api";
import { getReadProvider } from "@/blockchain/contracts";
import { OPERATION_LABEL } from "@/blockchain/enums";
import { NETWORK } from "@/blockchain/config";
import { useWallet } from "@/context/WalletContext";
import { formatBatchId, formatDateTime, parseBatchId } from "@/utils/format";

const TYPES = [
  "BatchRegistered", "TransferInitiated", "TransferAccepted", "TransferRejected", "TransferCancelled", "ShipmentRecorded", "WarehouseArrival",
  "QualityInspectionRecorded", "RetailArrival", "AvailableForSale", "Sold", "Recalled", "OutForDelivery", "UserRegistered", "ParticipantVerified",
  "ParticipantRejected", "VerificationRevoked", "OrderCreated", "PaymentDeposited", "PaymentReleased", "PaymentRefunded", "OrderCancelled", "TokenApproval", "TokenTransfer",
];

/** Re-checks an indexed transaction against the chain (receipt status + block). */
function VerifyCell({ tx }: { tx: IndexedTransaction }) {
  const [state, setState] = useState<"idle" | "loading" | "ok" | "bad">("idle");
  const [detail, setDetail] = useState("");
  const verify = async () => {
    setState("loading");
    try {
      const r = await getReadProvider().getTransactionReceipt(tx.hash);
      if (r && r.status === 1 && r.blockNumber === tx.blockNumber) {
        setState("ok");
        setDetail(`Confirmed in block ${r.blockNumber}`);
      } else {
        setState("bad");
        setDetail(r ? `Receipt status ${r.status}, block ${r.blockNumber}` : "Not found on-chain");
      }
    } catch (e) {
      setState("bad");
      setDetail((e as Error).message);
    }
  };
  if (state === "ok") return <Badge title={detail}><ShieldCheck /> Verified</Badge>;
  if (state === "bad") return <Badge variant="danger" title={detail}><XCircle /> Mismatch</Badge>;
  return (
    <Button size="sm" variant="ghost" onClick={verify} disabled={state === "loading"} title="Check this transaction directly on the blockchain">
      {state === "loading" ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Verify
    </Button>
  );
}

export function Transactions() {
  const { account } = useWallet();
  const [page, setPage] = useState(1);
  const [type, setType] = useState("");
  const [batch, setBatch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [mine, setMine] = useState(false);
  const batchId = batch ? parseBatchId(batch) : null;
  const params = {
    page,
    limit: 20,
    type: type || undefined,
    batchId: batchId ? String(batchId) : undefined,
    from: from || undefined,
    to: to ? `${to}T23:59:59` : undefined,
    wallet: mine && account ? account : undefined,
  };
  const q = useQuery({ queryKey: ["transactions", params], queryFn: () => api.transactions(params), placeholderData: (prev) => prev, retry: false });

  return (
    <div className="container max-w-7xl py-10">
      <PageHeader
        title="Transaction history"
        description={`Successful FarmChain transactions on ${NETWORK.name}, from the event index. Use “Verify” to confirm any row directly against the blockchain.`}
        eyebrow={<SourceBadge source="index" />}
      />
      <Card className="mb-4 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-ink"><Filter className="h-4 w-4" /> Filters</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1">
            <Label htmlFor="f-type" className="text-xs">Transaction type</Label>
            <NativeSelect id="f-type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
              <option value="">All types</option>
              {TYPES.map((t) => <option key={t} value={t}>{OPERATION_LABEL[t] ?? t}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-batch" className="text-xs">Batch ID</Label>
            <Input id="f-batch" placeholder="FC-10001" value={batch} onChange={(e) => { setBatch(e.target.value); setPage(1); }} aria-invalid={Boolean(batch && !batchId)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-from" className="text-xs">From date</Label>
            <Input id="f-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-to" className="text-xs">To date</Label>
            <Input id="f-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          </div>
          <div className="flex items-end gap-2">
            {account && (
              <label className="flex h-10 items-center gap-2 text-sm">
                <input type="checkbox" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(1); }} className="h-4 w-4 accent-[#14532D]" /> Only mine
              </label>
            )}
            <Button variant="ghost" size="sm" onClick={() => { setType(""); setBatch(""); setFrom(""); setTo(""); setMine(false); setPage(1); }}>Reset</Button>
          </div>
        </div>
      </Card>

      {q.isLoading ? (
        <Skeleton className="h-96" />
      ) : q.isError ? (
        <ErrorState title="Transaction index unavailable" message={`${(q.error as Error).message} Batch histories can still be verified on each trace page, which reads the chain directly.`} onRetry={() => q.refetch()} />
      ) : !q.data?.items.length ? (
        <EmptyState title="No transactions found" description="Adjust the filters or perform an action in the app." />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Transaction hash</TH>
                <TH>Operation</TH>
                <TH>Batch</TH>
                <TH>Sender</TH>
                <TH>Receiver</TH>
                <TH>Timestamp</TH>
                <TH>Status</TH>
                <TH className="text-right">On-chain check</TH>
              </TR>
            </THead>
            <TBody>
              {q.data.items.map((t) => (
                <TR key={t.hash}>
                  <TD><TxHashLink hash={t.hash} /><p className="text-[11px] text-muted-foreground">Block {t.blockNumber}</p></TD>
                  <TD className="whitespace-nowrap font-medium text-ink">{OPERATION_LABEL[t.operation] ?? t.operation}</TD>
                  <TD className="mono whitespace-nowrap text-xs">{t.batchId ? <Link to={`/trace/${t.batchId}`} className="text-secondary hover:underline">{formatBatchId(t.batchId)}</Link> : "—"}</TD>
                  <TD><AddressDisplay address={t.from} /></TD>
                  <TD>{t.counterparty ? <AddressDisplay address={t.counterparty} /> : <span className="text-xs text-muted-foreground">{t.contract ?? "—"}</span>}</TD>
                  <TD className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(t.timestamp)}</TD>
                  <TD>{t.status === "success" ? <Badge><CheckCircle2 /> Success</Badge> : <Badge variant="danger"><XCircle /> Failed</Badge>}</TD>
                  <TD className="text-right"><VerifyCell tx={t} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
            <span className="text-muted-foreground">{q.data.total} transactions · page {q.data.page} of {q.data.totalPages}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft /></Button>
              <Button size="sm" variant="outline" disabled={page >= q.data.totalPages} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight /></Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
