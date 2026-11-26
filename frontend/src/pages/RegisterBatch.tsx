import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Circle, ExternalLink, Loader2, Plus, Sprout, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, NativeSelect, Textarea } from "@/components/ui/primitives";
import { PageHeader, SourceBadge, TxHashLink, TxStatusPanel } from "@/components/common";
import { QRCodeCard } from "@/components/QRCodeCard";
import { useWallet } from "@/context/WalletContext";
import { useTransaction } from "@/hooks/useTransaction";
import { ACCEPTED_FILES, useIpfsStatus, validateFile } from "@/hooks/useIpfs";
import { contracts } from "@/blockchain/contracts";
import { ipfsUrl } from "@/blockchain/config";
import { api, ensureApiSession } from "@/services/api";
import { registerBatchFlow, RegistrationError, type RegistrationResult, type RegistrationStep } from "@/services/batchRegistration";
import { dateInputToUnix, formatBatchId, todayInput } from "@/utils/format";
import { cn } from "@/utils/cn";

export const CATEGORIES = ["Vegetables", "Fruits", "Grains", "Pulses", "Spices", "Dairy", "Oilseeds", "Plantation", "Flowers", "Other"];
export const UNITS = ["kg", "tonnes", "quintals", "litres", "crates", "dozens", "units"];

export const batchSchema = z.object({
  productName: z.string().trim().min(2, "Product name is required").max(128, "Max 128 characters"),
  category: z.string().min(1, "Choose a crop category"),
  description: z.string().trim().max(1000, "Max 1000 characters").optional().default(""),
  quantity: z.coerce.number({ invalid_type_error: "Enter a quantity" }).int("Use a whole number (choose a smaller unit for fractions)").positive("Quantity must be greater than zero").max(1_000_000_000),
  unit: z.string().min(1, "Choose a unit"),
  harvestDate: z
    .string()
    .min(1, "Harvest date is required")
    .refine((d) => dateInputToUnix(d) <= Date.now() / 1000 + 86400, "Harvest date cannot be in the future"),
  farmLocation: z.string().trim().min(2, "Farm location is required").max(80, "Max 80 characters"),
  state: z.string().trim().min(2, "State is required").max(40),
  district: z.string().trim().min(2, "District is required").max(40),
});
export type BatchValues = z.infer<typeof batchSchema>;

const STEPS: { key: RegistrationStep; label: string }[] = [
  { key: "validating", label: "Validate inputs" },
  { key: "uploading_files", label: "Upload photo & certificate to IPFS" },
  { key: "uploading_metadata", label: "Upload metadata JSON to IPFS" },
  { key: "awaiting_tx", label: "Register batch on blockchain" },
  { key: "confirmed", label: "Confirmed & QR generated" },
];

export function RegisterBatch() {
  const { account, getSigner } = useWallet();
  const ipfs = useIpfsStatus();
  const tx = useTransaction();
  const qc = useQueryClient();
  const [photo, setPhoto] = useState<File | null>(null);
  const [cert, setCert] = useState<File | null>(null);
  const [extra, setExtra] = useState<{ key: string; value: string }[]>([]);
  const [step, setStep] = useState<RegistrationStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [ackNoIpfs, setAckNoIpfs] = useState(false);

  const { register, handleSubmit, formState, reset } = useForm<BatchValues>({
    resolver: zodResolver(batchSchema),
    defaultValues: { harvestDate: todayInput(), unit: "kg", category: "", description: "" } as never,
  });
  const e = formState.errors;
  const ipfsConfigured = Boolean(ipfs.data?.configured);
  const ipfsKnown = ipfs.isSuccess;
  const busy = step !== null && step !== "confirmed" && !error;

  const onSubmit = async (v: BatchValues) => {
    setError(null);
    setResult(null);
    const fileErr = validateFile(photo) ?? validateFile(cert);
    if (fileErr) return setError(fileErr);
    if (!ipfsConfigured && !ackNoIpfs) return setError("IPFS is unavailable. Tick the confirmation box to register without off-chain metadata, or configure Pinata on the backend.");
    let signer;
    try {
      signer = await getSigner();
    } catch (err) {
      return setError((err as Error).message);
    }
    const registry = contracts(signer).productRegistry;
    try {
      const res = await registerBatchFlow(
        {
          productName: v.productName,
          category: v.category,
          description: v.description,
          quantity: v.quantity,
          unit: v.unit,
          harvestDate: dateInputToUnix(v.harvestDate),
          farmLocation: `${v.farmLocation}, ${v.district}, ${v.state}`.slice(0, 128),
          state: v.state,
          district: v.district,
          extraMetadata: Object.fromEntries(extra.filter((x) => x.key.trim()).map((x) => [x.key.trim(), x.value.trim()])),
        },
        {
          farmer: account!,
          ipfsConfigured,
          photo,
          certificate: cert,
          getToken: () => ensureApiSession(signer),
          uploadFile: api.uploadFile,
          uploadJson: api.uploadJson,
          nextBatchId: () => contracts().productRegistry.nextBatchId(),
          sendRegister: (expectedId, input) => tx.run("Register batch", () => registry.registerBatch(expectedId, input), { silent: false, successMessage: "Batch registered on blockchain" }),
          registryInterface: registry.interface,
          onStep: setStep,
          lastError: tx.lastErrorCode,
        },
      );
      setResult(res);
      qc.invalidateQueries({ queryKey: ["batches"] });
    } catch (err) {
      setError(err instanceof RegistrationError ? err.message : (err as Error).message);
    }
  };

  if (result) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader title="Batch registered" description="The transaction is confirmed on the blockchain." eyebrow={<SourceBadge source="chain" />} />
        <Card>
          <CardContent className="grid gap-8 pt-6 md:grid-cols-[1fr_auto]">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-full bg-accent text-forest"><CheckCircle2 className="h-6 w-6" /></div>
                <div>
                  <p className="text-sm text-muted-foreground">Batch ID</p>
                  <p className="text-2xl font-semibold text-ink">{formatBatchId(result.batchId)}</p>
                </div>
              </div>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Transaction hash</dt>
                  <dd><TxHashLink hash={result.txHash} /></dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Metadata CID (IPFS)</dt>
                  <dd className="mono break-all text-xs">
                    {result.metadataCID ? <a className="text-secondary hover:underline" href={ipfsUrl(result.metadataCID)} target="_blank" rel="noreferrer">{result.metadataCID}</a> : "None – registered without IPFS metadata"}
                  </dd>
                </div>
                {result.imageCID && <div><dt className="text-muted-foreground">Photo CID</dt><dd className="mono break-all text-xs">{result.imageCID}</dd></div>}
                {result.certificationCID && <div><dt className="text-muted-foreground">Certificate CID</dt><dd className="mono break-all text-xs">{result.certificationCID}</dd></div>}
              </dl>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button asChild><Link to={`/batches/${result.batchId}`}>Manage batch</Link></Button>
                <Button variant="outline" asChild><Link to={`/trace/${result.batchId}`}><ExternalLink /> Public trace page</Link></Button>
                <Button variant="ghost" onClick={() => { setResult(null); setStep(null); tx.reset(); reset(); setPhoto(null); setCert(null); }}>Register another</Button>
              </div>
            </div>
            <QRCodeCard batchId={result.batchId} />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Register agricultural product" description="Create a new batch with a unique on-chain identity. Files are stored on IPFS; only their hashes go on-chain." />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Sprout className="h-4 w-4 text-secondary" /> Product details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Product name" htmlFor="productName" error={e.productName?.message} required className="sm:col-span-2">
                <Input id="productName" placeholder="Organic Tomatoes" aria-invalid={!!e.productName} {...register("productName")} />
              </Field>
              <Field label="Crop category" htmlFor="category" error={e.category?.message} required>
                <NativeSelect id="category" aria-invalid={!!e.category} {...register("category")}>
                  <option value="">Select…</option>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Harvest date" htmlFor="harvestDate" error={e.harvestDate?.message} required>
                <Input id="harvestDate" type="date" max={todayInput()} aria-invalid={!!e.harvestDate} {...register("harvestDate")} />
              </Field>
              <Field label="Quantity" htmlFor="quantity" error={e.quantity?.message} required>
                <Input id="quantity" type="number" min={1} step={1} inputMode="numeric" aria-invalid={!!e.quantity} {...register("quantity")} />
              </Field>
              <Field label="Unit" htmlFor="unit" error={e.unit?.message} required>
                <NativeSelect id="unit" {...register("unit")}>
                  {UNITS.map((u) => <option key={u}>{u}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Product description" htmlFor="description" error={e.description?.message} hint="Stored in IPFS metadata" className="sm:col-span-2">
                <Textarea id="description" placeholder="Variety, farming practice, grade…" {...register("description")} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Farm location</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <Field label="Farm / village" htmlFor="farmLocation" error={e.farmLocation?.message} required>
                <Input id="farmLocation" placeholder="Green Valley Farms, Pollachi" aria-invalid={!!e.farmLocation} {...register("farmLocation")} />
              </Field>
              <Field label="District" htmlFor="district" error={e.district?.message} required>
                <Input id="district" placeholder="Coimbatore" aria-invalid={!!e.district} {...register("district")} />
              </Field>
              <Field label="State" htmlFor="state" error={e.state?.message} required>
                <Input id="state" placeholder="Tamil Nadu" aria-invalid={!!e.state} {...register("state")} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Supporting files</CardTitle>
              <CardDescription>JPG, PNG, WebP or PDF up to 10 MB. Uploaded to IPFS via the backend; the content hash is anchored on-chain.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {ipfsKnown && !ipfsConfigured && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> IPFS is not configured on the server</p>
                  <p className="mt-1">Photos, certificates and metadata cannot be uploaded until <code>PINATA_JWT</code> (or a local IPFS node) is configured in <code>backend/.env</code>.</p>
                  <label className="mt-2 flex items-center gap-2">
                    <input type="checkbox" checked={ackNoIpfs} onChange={(ev) => setAckNoIpfs(ev.target.checked)} className="h-4 w-4 accent-[#14532D]" />
                    Register this batch on-chain without off-chain metadata
                  </label>
                </div>
              )}
              {ipfs.isError && <p className="text-sm text-amber-700">Backend unreachable. IPFS status unknown.</p>}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Farm / product photograph" htmlFor="photo" error={validateFile(photo) ?? undefined}>
                  <Input id="photo" type="file" accept={ACCEPTED_FILES} disabled={!ipfsConfigured} onChange={(ev) => setPhoto(ev.target.files?.[0] ?? null)} />
                </Field>
                <Field label="Certification (e.g. organic)" htmlFor="cert" error={validateFile(cert) ?? undefined}>
                  <Input id="cert" type="file" accept={ACCEPTED_FILES} disabled={!ipfsConfigured} onChange={(ev) => setCert(ev.target.files?.[0] ?? null)} />
                </Field>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-ink">Optional metadata</p>
                  <Button type="button" size="sm" variant="ghost" disabled={!ipfsConfigured} onClick={() => setExtra((x) => [...x, { key: "", value: "" }])}><Plus /> Add field</Button>
                </div>
                {extra.map((row, i) => (
                  <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2">
                    <Input placeholder="e.g. Variety" value={row.key} onChange={(ev) => setExtra((x) => x.map((r, j) => (j === i ? { ...r, key: ev.target.value } : r)))} aria-label="Metadata key" />
                    <Input placeholder="e.g. PKM-1" value={row.value} onChange={(ev) => setExtra((x) => x.map((r, j) => (j === i ? { ...r, value: ev.target.value } : r)))} aria-label="Metadata value" />
                    <Button type="button" size="icon" variant="ghost" onClick={() => setExtra((x) => x.filter((_, j) => j !== i))} aria-label="Remove field"><Trash2 /></Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <Button type="submit" size="lg" loading={busy} className="w-full sm:w-auto">Register batch on blockchain</Button>
        </form>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader><CardTitle>Registration progress</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {STEPS.map((s) => {
                  const order = STEPS.map((x) => x.key);
                  const idx = step ? order.indexOf(step) : -1;
                  const mine = order.indexOf(s.key);
                  const skipped = !ipfsConfigured && (s.key === "uploading_files" || s.key === "uploading_metadata");
                  const done = idx > mine || step === "confirmed";
                  const active = idx === mine && !error && step !== "confirmed";
                  return (
                    <li key={s.key} className={cn("flex items-center gap-2 text-sm", skipped && "opacity-50")}>
                      {done ? <CheckCircle2 className="h-4 w-4 text-secondary" /> : active ? <Loader2 className="h-4 w-4 animate-spin text-secondary" /> : <Circle className="h-4 w-4 text-slate-300" />}
                      <span className={done || active ? "text-ink" : "text-muted-foreground"}>{s.label}{skipped ? " (skipped)" : ""}</span>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
          <TxStatusPanel state={tx.state} />
          <p className="text-xs text-muted-foreground">Success is only shown after the blockchain confirms the transaction.</p>
        </aside>
      </div>
    </div>
  );
}
