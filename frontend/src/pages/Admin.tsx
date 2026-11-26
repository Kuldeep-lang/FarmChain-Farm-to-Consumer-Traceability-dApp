import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ContractTransactionResponse } from "ethers";
import { Activity, Boxes, CheckCircle2, Clock, Pause, Play, ShieldCheck, Sprout, Truck, Users, XCircle, Ban, Contact } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Skeleton, Table, TBody, TD, TH, THead, TR, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AddressDisplay, EmptyState, ErrorState, PageHeader, SourceBadge, StageBadge, StatCard, TxStatusPanel, VerificationBadge } from "@/components/common";
import { useWallet } from "@/context/WalletContext";
import { useTransaction } from "@/hooks/useTransaction";
import { contracts } from "@/blockchain/contracts";
import { fetchAllParticipants, fetchChainTotals, fetchPauseState, type Participant } from "@/blockchain/reads";
import { api, ensureApiSession, type IndexedUser } from "@/services/api";
import type { StageName } from "@/blockchain/enums";
import { formatBatchId, formatDateTime, formatNumber } from "@/utils/format";

type AdminAction = { kind: "verify" | "reject" | "revoke"; user: Participant } | { kind: "pause" | "unpause"; contract: "ProductRegistry" | "SupplyChainTracker" | "PaymentEscrow" };

export function Admin() {
  const { getSigner } = useWallet();
  const qc = useQueryClient();
  const tx = useTransaction();
  const [action, setAction] = useState<AdminAction | null>(null);
  const [reason, setReason] = useState("");
  const [contacts, setContacts] = useState<Record<string, IndexedUser>>({});
  const [contactError, setContactError] = useState<string | null>(null);

  // Participants & totals are read from the chain (authoritative). Admin writes are enforced
  // by RoleManager's onlyRole(DEFAULT_ADMIN_ROLE); this page cannot bypass that.
  const participants = useQuery({ queryKey: ["admin-participants"], queryFn: fetchAllParticipants });
  const totals = useQuery({ queryKey: ["admin-totals"], queryFn: fetchChainTotals });
  const pause = useQuery({ queryKey: ["admin-pause"], queryFn: fetchPauseState });
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.stats, retry: false });
  const products = useQuery({ queryKey: ["admin-products"], queryFn: () => api.products({ limit: 50 }), retry: false });

  const list = participants.data ?? [];
  const pending = list.filter((p) => p.verification === "Pending");
  const verified = list.filter((p) => p.verification === "Verified");
  const others = list.filter((p) => p.verification === "Rejected" || p.verification === "Revoked");
  const counts = useMemo(
    () => ({
      farmers: verified.filter((p) => p.role === "Farmer").length,
      distributors: list.filter((p) => p.role === "Distributor").length,
    }),
    [list, verified],
  );

  const loadContacts = async () => {
    setContactError(null);
    try {
      const signer = await getSigner();
      const token = await ensureApiSession(signer);
      const res = await api.adminParticipants(token);
      setContacts(Object.fromEntries(res.items.map((u) => [u.wallet.toLowerCase(), u])));
    } catch (e) {
      setContactError((e as Error).message);
    }
  };

  const execute = async () => {
    if (!action) return;
    const signer = await getSigner();
    const c = contracts(signer);
    let send: () => Promise<ContractTransactionResponse>;
    let label: string;
    if (action.kind === "verify") {
      send = () => c.roleManager.verifyParticipant(action.user.wallet);
      label = `Verify ${action.user.name}`;
    } else if (action.kind === "reject") {
      send = () => c.roleManager.rejectParticipant(action.user.wallet, reason.trim());
      label = `Reject ${action.user.name}`;
    } else if (action.kind === "revoke") {
      send = () => c.roleManager.revokeVerification(action.user.wallet, reason.trim());
      label = `Revoke ${action.user.name}`;
    } else {
      const a = action as Extract<AdminAction, { contract: string }>;
      const target = a.contract === "ProductRegistry" ? c.productRegistry : a.contract === "SupplyChainTracker" ? c.tracker : c.escrow;
      send = () => (a.kind === "pause" ? target.pause() : target.unpause());
      label = `${a.kind === "pause" ? "Pause" : "Unpause"} ${a.contract}`;
    }
    const receipt = await tx.run(label, send);
    if (receipt) {
      qc.invalidateQueries({ queryKey: ["admin-participants"] });
      qc.invalidateQueries({ queryKey: ["admin-pause"] });
    }
  };

  const close = () => {
    if (tx.isBusy) return;
    setAction(null);
    setReason("");
    tx.reset();
  };

  const row = (p: Participant, actions: React.ReactNode) => {
    const c = contacts[p.wallet.toLowerCase()];
    return (
      <TR key={p.wallet}>
        <TD>
          <p className="font-medium text-ink">{p.name}</p>
          <p className="text-xs text-muted-foreground">{p.organization || "—"}</p>
        </TD>
        <TD><Badge variant="outline">{p.role}</Badge></TD>
        <TD className="text-sm">{p.location}</TD>
        <TD><AddressDisplay address={p.wallet} /></TD>
        <TD className="text-xs text-muted-foreground">{c ? <>{c.email || "—"}<br />{c.phone || ""}</> : <span className="italic">hidden</span>}</TD>
        <TD className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(p.registeredAt)}</TD>
        <TD><VerificationBadge status={p.verification} /></TD>
        <TD><div className="flex justify-end gap-1.5">{actions}</div></TD>
      </TR>
    );
  };

  const table = (rows: Participant[], render: (p: Participant) => React.ReactNode, empty: string) =>
    rows.length ? (
      <Card className="overflow-hidden">
        <Table>
          <THead><TR><TH>Participant</TH><TH>Role</TH><TH>Location</TH><TH>Wallet</TH><TH>Contact (off-chain)</TH><TH>Registered</TH><TH>Status</TH><TH className="text-right">Actions</TH></TR></THead>
          <TBody>{rows.map((p) => row(p, render(p)))}</TBody>
        </Table>
      </Card>
    ) : (
      <EmptyState title={empty} />
    );

  const needsReason = action && (action.kind === "reject" || action.kind === "revoke");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin console"
        description="Approve participants and monitor the network. Every action here is an on-chain transaction checked by RoleManager."
        eyebrow={<SourceBadge source="chain" />}
        actions={<Button variant="outline" onClick={loadContacts}><Contact /> Load contact details</Button>}
      />
      {contactError && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">Could not load private contact details: {contactError}</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {participants.isLoading || totals.isLoading ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[104px]" />) : (
          <>
            <StatCard label="Registered participants" value={list.length} icon={<Users />} />
            <StatCard label="Pending verifications" value={pending.length} icon={<Clock />} accent="amber" />
            <StatCard label="Verified farmers" value={counts.farmers} icon={<Sprout />} />
            <StatCard label="Distributors" value={counts.distributors} icon={<Truck />} accent="sky" />
            <StatCard label="Agricultural batches" value={totals.data?.batches ?? "—"} icon={<Boxes />} accent="violet" />
            <StatCard label="Blockchain transactions" value={stats.data ? formatNumber(stats.data.transactions) : "—"} icon={<Activity />} accent="slate" hint="From event index" />
          </>
        )}
      </div>

      {participants.isError ? (
        <ErrorState message={(participants.error as Error).message} onRetry={() => participants.refetch()} />
      ) : (
        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">Pending {pending.length > 0 && <Badge variant="warning" className="ml-1 px-1.5">{pending.length}</Badge>}</TabsTrigger>
            <TabsTrigger value="verified">Verified ({verified.length})</TabsTrigger>
            <TabsTrigger value="other">Rejected / revoked ({others.length})</TabsTrigger>
            <TabsTrigger value="batches">All batches</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
          </TabsList>
          <TabsContent value="pending">
            {table(pending, (p) => (
              <>
                <Button size="sm" onClick={() => setAction({ kind: "verify", user: p })}><CheckCircle2 /> Approve</Button>
                <Button size="sm" variant="outline" onClick={() => setAction({ kind: "reject", user: p })}><XCircle /> Reject</Button>
              </>
            ), "No pending verification requests")}
          </TabsContent>
          <TabsContent value="verified">
            {table(verified, (p) => <Button size="sm" variant="outline" className="text-destructive" onClick={() => setAction({ kind: "revoke", user: p })}><Ban /> Revoke</Button>, "No verified participants")}
          </TabsContent>
          <TabsContent value="other">
            {table(others, (p) => <Button size="sm" variant="soft" onClick={() => setAction({ kind: "verify", user: p })}><CheckCircle2 /> Approve</Button>, "No rejected or revoked participants")}
          </TabsContent>
          <TabsContent value="batches">
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div><CardTitle>All batches</CardTitle><CardDescription>Latest 50 from the index. Open a batch to read its verified on-chain record.</CardDescription></div>
                <SourceBadge source="index" />
              </CardHeader>
              <CardContent>
                {products.isError ? <p className="text-sm text-muted-foreground">Index unavailable.</p> : !products.data?.items.length ? <EmptyState title="No batches yet" /> : (
                  <Table>
                    <THead><TR><TH>Batch</TH><TH>Product</TH><TH>Farmer</TH><TH>Owner</TH><TH>Stage</TH><TH /></TR></THead>
                    <TBody>
                      {products.data.items.map((b) => (
                        <TR key={b.batchId}>
                          <TD className="mono text-xs font-semibold">{formatBatchId(b.batchId)}</TD>
                          <TD>{b.productName}<p className="text-xs text-muted-foreground">{b.quantity} {b.unit}</p></TD>
                          <TD><AddressDisplay address={b.farmer} /></TD>
                          <TD><AddressDisplay address={b.currentOwner} /></TD>
                          <TD><StageBadge stage={b.status as StageName} /></TD>
                          <TD className="text-right"><Button size="sm" variant="ghost" asChild><Link to={`/batches/${b.batchId}`}>Open</Link></Button></TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="system">
            <Card>
              <CardHeader>
                <CardTitle>Emergency pause</CardTitle>
                <CardDescription>Pausing blocks new batches, transfers, orders and deposits. Recalls, escrow releases and refunds always keep working, so user funds can never be frozen.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {pause.isLoading ? <Skeleton className="h-24" /> : pause.data && (Object.keys(pause.data) as (keyof typeof pause.data)[]).map((k) => (
                  <div key={k} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-ink"><ShieldCheck className="h-4 w-4 text-secondary" /> {k}</div>
                    <div className="flex items-center gap-2">
                      {pause.data[k] ? <Badge variant="danger">Paused</Badge> : <Badge>Active</Badge>}
                      <Button size="sm" variant="outline" onClick={() => setAction({ kind: pause.data![k] ? "unpause" : "pause", contract: k })}>
                        {pause.data[k] ? <><Play /> Unpause</> : <><Pause /> Pause</>}
                      </Button>
                    </div>
                  </div>
                ))}
                <p className="pt-2 text-xs text-muted-foreground">There is intentionally no admin function that can withdraw escrowed tokens.</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={Boolean(action)} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action?.kind === "verify" && `Approve ${action.user.name}`}
              {action?.kind === "reject" && `Reject ${action.user.name}`}
              {action?.kind === "revoke" && `Revoke ${action.user.name}`}
              {(action?.kind === "pause" || action?.kind === "unpause") && `${action.kind === "pause" ? "Pause" : "Unpause"} ${action.contract}`}
            </DialogTitle>
            <DialogDescription>
              {action?.kind === "verify" && `Grants the ${action.user.role.toUpperCase()}_ROLE on-chain. They can then act as a ${action.user.role.toLowerCase()}.`}
              {action?.kind === "reject" && "Marks the registration as rejected. The participant receives no role."}
              {action?.kind === "revoke" && "Removes every participant role immediately. All of their write actions will be blocked by the contracts."}
              {action?.kind === "pause" && "Blocks state-changing operations on this contract until unpaused."}
              {action?.kind === "unpause" && "Re-enables normal operation."}
            </DialogDescription>
          </DialogHeader>
          {needsReason && tx.state.phase !== "confirmed" && (
            <Field label="Reason" htmlFor="reason" hint="Stored publicly on-chain (max 256 characters). Do not include personal data.">
              <Textarea id="reason" value={reason} maxLength={256} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
          <TxStatusPanel state={tx.state} />
          <DialogFooter>
            {tx.state.phase === "confirmed" ? <Button onClick={close}>Done</Button> : (
              <>
                <Button variant="outline" onClick={close} disabled={tx.isBusy}>Cancel</Button>
                <Button variant={action?.kind === "revoke" || action?.kind === "reject" || action?.kind === "pause" ? "destructive" : "default"} onClick={execute} loading={tx.isBusy}>Confirm transaction</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
