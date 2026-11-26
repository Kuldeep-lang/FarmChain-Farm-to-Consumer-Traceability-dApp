import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatUnits, parseUnits, type ContractTransactionResponse } from "ethers";
import { Ban, CheckCircle2, Coins, Droplets, HandCoins, Info, PlusCircle, RotateCcw, ShieldCheck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Skeleton, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { AddressDisplay, EmptyState, ErrorState, PageHeader, SourceBadge, StatCard, TxStatusPanel } from "@/components/common";
import { useWallet } from "@/context/WalletContext";
import { useTransaction } from "@/hooks/useTransaction";
import { useMyOrders } from "@/hooks/useBatches";
import { contracts } from "@/blockchain/contracts";
import { fetchBatch, fetchTokenInfo, type Order } from "@/blockchain/reads";
import { formatBatchId, formatDateTime, formatNumber, parseBatchId } from "@/utils/format";

const fmt = (v: bigint) => formatNumber(Number(formatUnits(v, 18)));
const STATUS_VARIANT = { Created: "outline", Funded: "info", Released: "default", Refunded: "warning", Cancelled: "muted" } as const;

export function Payments() {
  const { account, getSigner } = useWallet();
  const qc = useQueryClient();
  const tx = useTransaction();
  const orders = useMyOrders();
  const token = useQuery({ queryKey: ["token", account], queryFn: () => fetchTokenInfo(account!), enabled: Boolean(account) });
  const [batchInput, setBatchInput] = useState("");
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState("7");
  const [formError, setFormError] = useState<string | null>(null);

  const batchId = parseBatchId(batchInput);
  const target = useQuery({ queryKey: ["order-batch", batchId], queryFn: () => fetchBatch(batchId!), enabled: batchId !== null });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["orders"] });
    qc.invalidateQueries({ queryKey: ["token"] });
  };

  const send = async (label: string, fn: (c: ReturnType<typeof contracts>) => Promise<ContractTransactionResponse>) => {
    let signer;
    try {
      signer = await getSigner();
    } catch (e) {
      setFormError((e as Error).message);
      return null;
    }
    const r = await tx.run(label, () => fn(contracts(signer)));
    if (r) refresh();
    return r;
  };

  const createOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!batchId || !target.data) return setFormError("Enter an existing batch ID");
    if (target.data.currentOwner.toLowerCase() === account?.toLowerCase()) return setFormError("You already own this batch");
    let wei: bigint;
    try {
      wei = parseUnits(amount || "0", 18);
    } catch {
      return setFormError("Enter a valid amount");
    }
    if (wei <= 0n) return setFormError("Amount must be greater than zero");
    const d = Number(days);
    if (!Number.isFinite(d) || d < 1 || d > 180) return setFormError("Delivery window must be 1–180 days");
    const r = await send("Create escrow order", (c) => c.escrow.createOrder(batchId, target.data!.currentOwner, wei, BigInt(Math.round(d * 86400))));
    if (r) {
      setBatchInput("");
      setAmount("");
    }
  };

  /** Approve (if needed) then deposit – two separate, individually confirmed transactions. */
  const deposit = async (o: Order) => {
    const info = await fetchTokenInfo(account!);
    if (info.balance < o.amount) return setFormError(`Insufficient fUSD balance (${fmt(info.balance)} available). Use the faucet.`);
    if (info.allowance < o.amount) {
      const ok = await send("Approve escrow to spend fUSD", async (c) => c.token.approve(await c.escrow.getAddress(), o.amount));
      if (!ok) return;
    }
    await send(`Deposit payment for order #${o.id}`, (c) => c.escrow.depositPayment(o.id));
  };

  const me = account?.toLowerCase() ?? "";
  const list = orders.data ?? [];
  const escrowed = list.filter((o) => o.status === "Funded").reduce((s, o) => s + o.amount, 0n);
  const received = list.filter((o) => o.status === "Released" && o.seller.toLowerCase() === me).reduce((s, o) => s + o.amount, 0n);
  const now = Date.now();
  const faucetReady = !token.data || token.data.lastFaucetAt === 0 || now / 1000 > token.data.lastFaucetAt + 3600;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments & escrow"
        description="Pay for batches through the PaymentEscrow contract using the fUSD test token. Funds can only go to the seller (on delivery) or back to the buyer (refund)."
        eyebrow={<SourceBadge source="chain" />}
        actions={
          <Button variant="outline" onClick={() => send("Claim 10,000 test fUSD", (c) => c.token.faucet())} disabled={!faucetReady || tx.isBusy}>
            <Droplets /> {faucetReady ? "Get test fUSD" : "Faucet cooling down"}
          </Button>
        }
      />
      <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" /> fUSD is a test-only ERC-20 token with no monetary value, used on local Hardhat and Sepolia.
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Your fUSD balance" value={token.data ? fmt(token.data.balance) : "—"} icon={<Wallet />} />
        <StatCard label="Currently in escrow" value={fmt(escrowed)} icon={<ShieldCheck />} accent="sky" hint="Funded orders you are party to" />
        <StatCard label="Received from sales" value={fmt(received)} icon={<HandCoins />} accent="amber" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card className="self-start">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><PlusCircle className="h-4 w-4 text-secondary" /> Create order</CardTitle>
            <CardDescription>You are the buyer. The seller is the batch's current on-chain owner.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createOrder} className="space-y-4">
              <Field label="Batch ID" htmlFor="o-batch" required>
                <Input id="o-batch" placeholder="FC-10001" value={batchInput} onChange={(e) => setBatchInput(e.target.value)} />
              </Field>
              {target.data && (
                <div className="rounded-lg bg-slate-50 p-3 text-sm">
                  <p className="font-medium text-ink">{target.data.productName} · {formatNumber(target.data.quantity)} {target.data.unit}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Seller (current owner):</p>
                  <AddressDisplay address={target.data.currentOwner} />
                </div>
              )}
              {batchId !== null && target.isSuccess && !target.data && <p className="text-xs text-destructive">Batch not found on-chain.</p>}
              <Field label="Amount (fUSD)" htmlFor="o-amount" required>
                <Input id="o-amount" inputMode="decimal" placeholder="2500" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <Field label="Delivery window (days)" htmlFor="o-days" hint="After this deadline, you can reclaim funds if you never received custody." required>
                <Input id="o-days" type="number" min={1} max={180} value={days} onChange={(e) => setDays(e.target.value)} />
              </Field>
              {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
              <Button type="submit" className="w-full" loading={tx.isBusy}>Create order</Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <TxStatusPanel state={tx.state} />
          {orders.isLoading ? <Skeleton className="h-64" /> : orders.isError ? <ErrorState message={(orders.error as Error).message} /> : !list.length ? (
            <EmptyState icon={<Coins className="h-5 w-5" />} title="No orders yet" description="Create an order to pay for a batch through escrow." />
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <THead><TR><TH>Order</TH><TH>Batch</TH><TH>Counterparty</TH><TH>Amount</TH><TH>Status</TH><TH>Deadline</TH><TH className="text-right">Actions</TH></TR></THead>
                <TBody>
                  {list.map((o) => {
                    const buyer = o.buyer.toLowerCase() === me;
                    const expired = o.deliveryDeadline ? o.deliveryDeadline.getTime() < now : false;
                    return (
                      <TR key={o.id}>
                        <TD className="mono text-xs font-semibold">#{o.id}<p className="font-sans text-[11px] font-normal text-muted-foreground">{buyer ? "You buy" : "You sell"}</p></TD>
                        <TD><Link to={`/trace/${o.batchId}`} className="mono text-xs text-secondary hover:underline">{formatBatchId(o.batchId)}</Link></TD>
                        <TD><AddressDisplay address={buyer ? o.seller : o.buyer} /></TD>
                        <TD className="whitespace-nowrap tabular-nums">{fmt(o.amount)} fUSD</TD>
                        <TD><Badge variant={STATUS_VARIANT[o.status]}>{o.status}</Badge></TD>
                        <TD className="whitespace-nowrap text-xs text-muted-foreground">{o.deliveryDeadline ? formatDateTime(o.deliveryDeadline) : "Starts on deposit"}</TD>
                        <TD>
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {o.status === "Created" && buyer && <Button size="sm" onClick={() => deposit(o)} disabled={tx.isBusy}><Coins /> Deposit</Button>}
                            {o.status === "Created" && <Button size="sm" variant="outline" onClick={() => send(`Cancel order #${o.id}`, (c) => c.escrow.cancelOrder(o.id))} disabled={tx.isBusy}><Ban /> Cancel</Button>}
                            {o.status === "Funded" && buyer && <Button size="sm" onClick={() => send(`Confirm delivery #${o.id}`, (c) => c.escrow.confirmDelivery(o.id))} disabled={tx.isBusy}><CheckCircle2 /> Confirm delivery</Button>}
                            {o.status === "Funded" && <Button size="sm" variant="soft" title="Releases funds if the buyer has accepted custody on-chain" onClick={() => send(`Release payment #${o.id}`, (c) => c.escrow.releasePayment(o.id))} disabled={tx.isBusy}><HandCoins /> Release</Button>}
                            {o.status === "Funded" && (!buyer || expired) && (
                              <Button size="sm" variant="outline" onClick={() => send(`Refund order #${o.id}`, (c) => c.escrow.requestRefund(o.id))} disabled={tx.isBusy}><RotateCcw /> Refund</Button>
                            )}
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </Card>
          )}
          <Card>
            <CardContent className="space-y-1 pt-5 text-xs text-muted-foreground">
              <p className="font-medium text-ink">Escrow rules (enforced by the contract)</p>
              <p>• <strong>Confirm delivery</strong> (buyer) releases funds to the seller immediately.</p>
              <p>• <strong>Release</strong> works for either party once the buyer has accepted custody of the batch on-chain.</p>
              <p>• <strong>Refund</strong>: the seller can refund at any time; the buyer only after the deadline and only if custody was never transferred.</p>
              <p>• No administrator can withdraw escrowed funds.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
