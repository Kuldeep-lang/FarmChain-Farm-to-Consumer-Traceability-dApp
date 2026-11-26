import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAddress, type ContractTransactionResponse, type JsonRpcSigner } from "ethers";
import { toast } from "sonner";
import { AlertOctagon, ArrowRightLeft, Ban, Check, ClipboardCheck, PackageCheck, ShoppingBag, Store, Truck, Warehouse, X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/primitives";
import { TxStatusPanel } from "./common";
import { useWallet } from "@/context/WalletContext";
import { useTransaction } from "@/hooks/useTransaction";
import { ACCEPTED_FILES, uploadEventDocument, useIpfsStatus, validateFile } from "@/hooks/useIpfs";
import { contracts } from "@/blockchain/contracts";
import { StageId, TRANSFER_TARGETS, type RoleName } from "@/blockchain/enums";
import type { BatchWithPending } from "@/blockchain/reads";
import { api } from "@/services/api";
import { formatBatchId, shortAddress } from "@/utils/format";

type Fields = {
  location?: "required" | "optional";
  locationLabel?: string;
  notes?: boolean;
  document?: boolean;
  passFail?: boolean;
  reason?: boolean;
  recipientRoles?: RoleName[];
};

export interface ActionConfig {
  key: string;
  label: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  fields: Fields;
  confirmLabel: string;
  variant?: "default" | "outline" | "destructive" | "soft";
  docKind?: string;
  execute: (ctx: { signer: JsonRpcSigner; location: string; cid: string; passed: boolean; reason: string; recipient: string }) => Promise<ContractTransactionResponse>;
}

const lower = (a?: string | null) => (a ?? "").toLowerCase();

/** Computes which on-chain actions the connected wallet may take (mirrors contract rules). */
export function getBatchActions(batch: BatchWithPending, me: string, role: RoleName, isAdmin: boolean): ActionConfig[] {
  const id = batch.id;
  const owner = lower(batch.currentOwner) === lower(me);
  const p = batch.pending;
  const final = batch.status === "SOLD" || batch.status === "RECALLED";
  const retail = batch.status === "AT_RETAILER" || batch.status === "AVAILABLE_FOR_SALE";
  const t = (s: JsonRpcSigner) => contracts(s).tracker;
  const out: ActionConfig[] = [];

  if (p && lower(p.to) === lower(me)) {
    out.push({
      key: "accept", label: "Accept", icon: <Check />, title: `Accept ${formatBatchId(id)}`, variant: "default",
      description: `Take custody of ${batch.quantity} ${batch.unit} of ${batch.productName} offered by ${shortAddress(p.from)}. Ownership changes only after this transaction confirms.`,
      fields: {}, confirmLabel: "Accept batch",
      execute: ({ signer }) => t(signer).acceptTransfer(id),
    });
    out.push({
      key: "reject", label: "Reject", icon: <X />, title: `Reject ${formatBatchId(id)}`, variant: "outline",
      description: "Decline this batch. Custody stays with the sender and the rejection is recorded permanently.",
      fields: { reason: true }, confirmLabel: "Reject batch",
      execute: ({ signer, reason }) => t(signer).rejectTransfer(id, reason),
    });
  }
  if (p && lower(p.from) === lower(me)) {
    out.push({
      key: "cancel", label: "Cancel transfer", icon: <Ban />, title: "Cancel pending transfer", variant: "outline",
      description: `Withdraw the offer to ${shortAddress(p.to)}.`, fields: {}, confirmLabel: "Cancel transfer",
      execute: ({ signer }) => t(signer).cancelTransfer(id),
    });
  }

  if (owner && !p && !final && role !== "None") {
    if (role === "Distributor" && !retail) {
      out.push({
        key: "ship", label: "Record shipment", icon: <Truck />, title: "Record shipment", docKind: "shipment",
        description: "Mark the batch as in transit with route / vehicle details.",
        fields: { location: "required", locationLabel: "Route / current location", notes: true, document: true }, confirmLabel: "Record shipment",
        execute: ({ signer, location, cid }) => t(signer).recordShipment(id, location, cid),
      });
    }
    if (role === "Warehouse" && !retail) {
      out.push({
        key: "arrival", label: batch.status === "AT_WAREHOUSE" || batch.status === "QUALITY_CHECKED" ? "Update storage" : "Confirm arrival", icon: <Warehouse />,
        title: "Confirm warehouse arrival", docKind: "storage",
        description: "Record that the batch is physically in storage, with its storage location and conditions.",
        fields: { location: "required", locationLabel: "Storage location (e.g. Cold room 3, 4°C)", notes: true, document: true }, confirmLabel: "Record arrival",
        execute: ({ signer, location, cid }) => t(signer).recordWarehouseArrival(id, location, cid),
      });
      if (batch.status === "AT_WAREHOUSE" || batch.status === "QUALITY_CHECKED") {
        out.push({
          key: "inspect", label: "Quality inspection", icon: <ClipboardCheck />, title: "Record quality inspection", docKind: "inspection",
          description: "Record the result of a quality inspection. The blockchain records who declared the result and when; it cannot itself verify physical quality.",
          fields: { location: "optional", locationLabel: "Inspection location", passFail: true, notes: true, document: true }, confirmLabel: "Record inspection",
          execute: ({ signer, location, cid, passed }) => t(signer).recordQualityInspection(id, passed, location, cid),
        });
      }
    }
    if ((role === "Distributor" || role === "Warehouse") && !retail && batch.status !== "OUT_FOR_DELIVERY") {
      out.push({
        key: "ofd", label: "Out for delivery", icon: <Truck />, title: "Mark out for delivery", variant: "outline",
        description: "Signal that the batch has left for its next destination.",
        fields: { location: "optional", locationLabel: "Dispatch location" }, confirmLabel: "Confirm",
        execute: ({ signer, location }) => t(signer).updateBatchStatus(id, StageId.OUT_FOR_DELIVERY, location, ""),
      });
    }
    if (role === "Retailer" && !retail) {
      out.push({
        key: "retail", label: "Confirm receipt", icon: <Store />, title: "Confirm retail arrival", docKind: "retail-arrival",
        description: "Record that the batch has arrived at your store.",
        fields: { location: "required", locationLabel: "Store location", notes: true, document: true }, confirmLabel: "Confirm receipt",
        execute: ({ signer, location, cid }) => t(signer).recordRetailArrival(id, location, cid),
      });
    }
    if (role === "Retailer" && batch.status === "AT_RETAILER") {
      out.push({
        key: "available", label: "Available for sale", icon: <ShoppingBag />, title: "Mark available for sale",
        description: "Put the batch on the shelf. Consumers will see it as available.",
        fields: { location: "optional", locationLabel: "Shelf / store" }, confirmLabel: "Mark available",
        execute: ({ signer, location }) => t(signer).updateBatchStatus(id, StageId.AVAILABLE_FOR_SALE, location, ""),
      });
    }
    if (role === "Retailer" && batch.status === "AVAILABLE_FOR_SALE") {
      out.push({
        key: "sold", label: "Mark sold", icon: <CheckCircle2 />, title: "Mark batch as sold", variant: "outline",
        description: "Mark the whole batch as sold out. This is final.",
        fields: { location: "optional", locationLabel: "Store" }, confirmLabel: "Mark sold",
        execute: ({ signer, location }) => t(signer).updateBatchStatus(id, StageId.SOLD, location, ""),
      });
    }
    const targets = TRANSFER_TARGETS[role as Exclude<RoleName, "None">] ?? [];
    if (targets.length && !retail && !(role === "Farmer" && batch.status !== "REGISTERED")) {
      out.push({
        key: "transfer", label: "Transfer", icon: <ArrowRightLeft />, title: `Transfer ${formatBatchId(id)}`, docKind: "transfer",
        description: `Offer custody to a verified ${targets.join(" or ").toLowerCase()}. They must accept before ownership changes.`,
        fields: { recipientRoles: targets, location: "optional", locationLabel: "Handover location", document: true }, confirmLabel: "Initiate transfer",
        execute: ({ signer, recipient, location, cid }) => t(signer).initiateTransfer(id, recipient, location, cid),
      });
    }
  }

  if ((isAdmin || lower(batch.farmer) === lower(me)) && batch.status !== "RECALLED") {
    out.push({
      key: "recall", label: "Recall", icon: <AlertOctagon />, title: `Recall ${formatBatchId(id)}`, variant: "destructive", docKind: "recall",
      description: "Flag this batch as recalled for safety reasons. Consumers will see a recall warning. This cannot be undone.",
      fields: { location: "optional", locationLabel: "Location", notes: true, document: true }, confirmLabel: "Recall batch",
      execute: ({ signer, location, cid }) => t(signer).updateBatchStatus(id, StageId.RECALLED, location, cid),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ dialog */

export function BatchActionDialog({ batch, action, open, onOpenChange, onDone }: { batch: BatchWithPending; action: ActionConfig | null; open: boolean; onOpenChange: (o: boolean) => void; onDone?: () => void }) {
  const { getSigner, account } = useWallet();
  const tx = useTransaction();
  const ipfs = useIpfsStatus();
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [passed, setPassed] = useState(true);
  const [recipient, setRecipient] = useState("");
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const f = action?.fields ?? {};

  const recipients = useQuery({
    queryKey: ["recipients", f.recipientRoles?.join(",")],
    queryFn: async () => {
      const lists = await Promise.all((f.recipientRoles ?? []).map((role) => api.users({ role, status: "Verified", limit: 100 })));
      return lists.flatMap((l) => l.items).filter((u) => lower(u.wallet) !== lower(account));
    },
    enabled: open && Boolean(f.recipientRoles?.length),
    retry: false,
  });

  const reset = () => {
    setLocation(""); setNotes(""); setReason(""); setFile(null); setPassed(true); setRecipient(""); setManual(""); setError(null);
    tx.reset();
  };

  const submit = async () => {
    if (!action) return;
    setError(null);
    if (f.location === "required" && !location.trim()) return setError("Location is required");
    if (location.length > 128) return setError("Location must be at most 128 characters");
    if (reason.length > 256) return setError("Reason must be at most 256 characters");
    const fileErr = validateFile(file);
    if (fileErr) return setError(fileErr);
    const to = (recipient === "manual" ? manual : recipient).trim();
    if (f.recipientRoles && !isAddress(to)) return setError("Choose a recipient or enter a valid wallet address");

    setPreparing(true);
    let cid = "";
    let signer: JsonRpcSigner;
    try {
      signer = await getSigner();
      if (f.recipientRoles) {
        const allowed = await contracts().tracker.canTransfer(account, to);
        if (!allowed) throw new Error(`On-chain check failed: this wallet cannot transfer to ${shortAddress(to)} (recipient must be a verified ${f.recipientRoles.join("/")}).`);
      }
      cid = await uploadEventDocument(signer, {
        batchId: batch.id,
        kind: action.docKind ?? action.key,
        file,
        notes: f.notes ? notes : "",
        extra: f.passFail ? { result: passed ? "PASSED" : "FAILED" } : undefined,
        ipfsConfigured: Boolean(ipfs.data?.configured),
      });
    } catch (e) {
      setPreparing(false);
      return setError((e as Error).message);
    }
    setPreparing(false);
    const receipt = await tx.run(action.title, () => action.execute({ signer, location: location.trim(), cid, passed, reason: reason.trim(), recipient: to }));
    if (receipt) onDone?.();
  };

  const done = tx.state.phase === "confirmed";
  const ipfsOff = ipfs.data && !ipfs.data.configured;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!tx.isBusy) { onOpenChange(o); if (!o) reset(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action?.title}</DialogTitle>
          <DialogDescription>{action?.description}</DialogDescription>
        </DialogHeader>

        {!done && action && (
          <div className="space-y-4">
            {f.recipientRoles && (
              <Field label="Recipient" htmlFor="recipient" required hint="Only verified participants of an allowed role can receive custody.">
                <NativeSelect id="recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)}>
                  <option value="">{recipients.isLoading ? "Loading participants…" : "Select a verified participant"}</option>
                  {recipients.data?.map((u) => (
                    <option key={u.wallet} value={u.wallet}>
                      {u.name} · {u.role} · {shortAddress(u.wallet)}
                    </option>
                  ))}
                  <option value="manual">Enter wallet address manually…</option>
                </NativeSelect>
                {recipients.isError && <p className="text-xs text-amber-700">Participant directory unavailable (backend offline) – enter the address manually.</p>}
                {recipient === "manual" && <Input className="mt-2" placeholder="0x…" value={manual} onChange={(e) => setManual(e.target.value)} aria-label="Recipient wallet address" />}
              </Field>
            )}
            {f.passFail && (
              <Field label="Inspection result" htmlFor="result" required>
                <div className="grid grid-cols-2 gap-2" id="result">
                  <Button type="button" variant={passed ? "default" : "outline"} onClick={() => setPassed(true)}>Passed</Button>
                  <Button type="button" variant={!passed ? "destructive" : "outline"} onClick={() => setPassed(false)}>Failed</Button>
                </div>
              </Field>
            )}
            {f.location && (
              <Field label={f.locationLabel ?? "Location"} htmlFor="loc" required={f.location === "required"}>
                <Input id="loc" value={location} maxLength={128} onChange={(e) => setLocation(e.target.value)} />
              </Field>
            )}
            {f.reason && (
              <Field label="Reason" htmlFor="reason" hint="Stored publicly on-chain. Do not include personal data.">
                <Textarea id="reason" value={reason} maxLength={256} onChange={(e) => setReason(e.target.value)} />
              </Field>
            )}
            {f.notes && (
              <Field label="Notes (optional)" htmlFor="notes" hint={ipfsOff ? "IPFS is not configured – notes cannot be stored." : "Stored on IPFS; its content hash is anchored on-chain."}>
                <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={Boolean(ipfsOff)} />
              </Field>
            )}
            {f.document && (
              <Field label="Supporting document (optional)" htmlFor="doc" hint={ipfsOff ? "IPFS is not configured – documents cannot be uploaded." : "JPG, PNG, WebP or PDF up to 10 MB."}>
                <Input id="doc" type="file" accept={ACCEPTED_FILES} disabled={Boolean(ipfsOff)} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </Field>
            )}
            {error && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
          </div>
        )}

        <TxStatusPanel state={tx.state} />

        <DialogFooter>
          {done ? (
            <Button onClick={() => { onOpenChange(false); reset(); }}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={tx.isBusy || preparing}>Cancel</Button>
              <Button variant={action?.variant === "destructive" ? "destructive" : "default"} onClick={submit} loading={tx.isBusy || preparing}>
                {preparing ? "Preparing…" : action?.confirmLabel}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Renders the available action buttons for a batch and manages the dialog. */
export function BatchActions({ batch, role, isAdmin, size = "sm", limit, onDone }: { batch: BatchWithPending; role: RoleName; isAdmin: boolean; size?: "sm" | "default"; limit?: number; onDone?: () => void }) {
  const { account } = useWallet();
  const qc = useQueryClient();
  const [active, setActive] = useState<ActionConfig | null>(null);
  const actions = useMemo(() => (account ? getBatchActions(batch, account, role, isAdmin) : []), [batch, account, role, isAdmin]);
  const shown = limit ? actions.slice(0, limit) : actions;
  if (!actions.length) return null;
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((a) => (
          <Button key={a.key} size={size} variant={a.variant ?? (a.key === "accept" ? "default" : "soft")} onClick={() => setActive(a)}>
            {a.icon} {a.label}
          </Button>
        ))}
      </div>
      <BatchActionDialog
        batch={batch}
        action={active}
        open={Boolean(active)}
        onOpenChange={(o) => !o && setActive(null)}
        onDone={() => {
          qc.invalidateQueries();
          toast.message("On-chain state updated", { description: `${formatBatchId(batch.id)} refreshed from the blockchain.` });
          onDone?.();
        }}
      />
    </>
  );
}

export const AcceptIcon = PackageCheck;
