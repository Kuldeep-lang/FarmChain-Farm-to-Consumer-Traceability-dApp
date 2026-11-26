import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, Info, Sprout, Store, Truck, UserPlus, Warehouse, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from "@/components/ui/primitives";
import { PageHeader, TxHashLink, TxStatusPanel, VerificationBadge } from "@/components/common";
import { useWallet } from "@/context/WalletContext";
import { dashboardPath, useParticipant } from "@/hooks/useParticipant";
import { useTransaction } from "@/hooks/useTransaction";
import { ACCEPTED_FILES, useIpfsStatus, validateFile } from "@/hooks/useIpfs";
import { contracts } from "@/blockchain/contracts";
import { RoleId } from "@/blockchain/enums";
import { api, ensureApiSession } from "@/services/api";
import { formatDateTime } from "@/utils/format";
import { cn } from "@/utils/cn";

export const registrationSchema = z.object({
  name: z.string().trim().min(2, "Full name is required").max(128, "Max 128 characters"),
  organization: z.string().trim().max(128, "Max 128 characters").optional().default(""),
  email: z.string().trim().email("Enter a valid email").max(254).or(z.literal("")).default(""),
  phone: z.string().trim().regex(/^[+0-9 ()-]{6,20}$/, "Enter a valid phone number").or(z.literal("")).default(""),
  location: z.string().trim().min(2, "Location is required").max(128, "Max 128 characters"),
  role: z.enum(["Farmer", "Distributor", "Warehouse", "Retailer"], { errorMap: () => ({ message: "Choose a participant role" }) }),
});
export type RegistrationValues = z.infer<typeof registrationSchema>;

const ROLE_OPTIONS = [
  { value: "Farmer", icon: <Sprout />, text: "Register harvest batches" },
  { value: "Distributor", icon: <Truck />, text: "Transport produce" },
  { value: "Warehouse", icon: <Warehouse />, text: "Store & inspect" },
  { value: "Retailer", icon: <Store />, text: "Sell to consumers" },
] as const;

export function RegistrationForm({ onSubmit, disabled, ipfsConfigured }: { onSubmit: (v: RegistrationValues, photo: File | null) => void; disabled?: boolean; ipfsConfigured: boolean }) {
  const { register, handleSubmit, watch, setValue, formState } = useForm<RegistrationValues>({ resolver: zodResolver(registrationSchema), defaultValues: { organization: "", email: "", phone: "" } as never });
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const role = watch("role");
  const e = formState.errors;

  return (
    <form
      noValidate
      onSubmit={handleSubmit((v) => {
        if (photoError) return;
        onSubmit(v, photo);
      })}
      className="space-y-5"
    >
      <div>
        <p className="mb-2 text-sm font-medium text-ink">Participant role <span className="text-destructive">*</span></p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Participant role">
          {ROLE_OPTIONS.map((r) => (
            <button
              type="button"
              key={r.value}
              role="radio"
              aria-checked={role === r.value}
              onClick={() => setValue("role", r.value, { shouldValidate: true })}
              className={cn(
                "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition [&_svg]:h-5 [&_svg]:w-5",
                role === r.value ? "border-secondary bg-accent/60 ring-2 ring-secondary/30" : "hover:bg-muted",
              )}
            >
              <span className="text-forest">{r.icon}</span>
              <span className="text-sm font-semibold text-ink">{r.value}</span>
              <span className="text-xs text-muted-foreground">{r.text}</span>
            </button>
          ))}
        </div>
        {e.role && <p role="alert" className="mt-1 text-xs font-medium text-destructive">{e.role.message}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="name" error={e.name?.message} required hint="Public, stored on-chain">
          <Input id="name" aria-invalid={!!e.name} {...register("name")} />
        </Field>
        <Field label="Organization name" htmlFor="organization" error={e.organization?.message} hint="Public, stored on-chain">
          <Input id="organization" {...register("organization")} />
        </Field>
        <Field label="Email address" htmlFor="email" error={e.email?.message} hint="Private, kept off-chain">
          <Input id="email" type="email" aria-invalid={!!e.email} {...register("email")} />
        </Field>
        <Field label="Phone number" htmlFor="phone" error={e.phone?.message} hint="Private, kept off-chain">
          <Input id="phone" type="tel" aria-invalid={!!e.phone} {...register("phone")} />
        </Field>
        <Field label="Location" htmlFor="location" error={e.location?.message} required hint="City, state. Public, stored on-chain" className="sm:col-span-2">
          <Input id="location" placeholder="Coimbatore, Tamil Nadu" aria-invalid={!!e.location} {...register("location")} />
        </Field>
        <Field label="Profile photograph (optional)" htmlFor="photo" error={photoError ?? undefined} hint={ipfsConfigured ? "Uploaded to IPFS" : "IPFS not configured on the server, so photo upload is disabled"} className="sm:col-span-2">
          <Input
            id="photo"
            type="file"
            accept={ACCEPTED_FILES}
            disabled={!ipfsConfigured}
            onChange={(ev) => {
              const f = ev.target.files?.[0] ?? null;
              setPhoto(f);
              setPhotoError(validateFile(f));
            }}
          />
        </Field>
      </div>
      <Button type="submit" size="lg" className="w-full sm:w-auto" loading={disabled}>
        <UserPlus /> Register on blockchain
      </Button>
    </form>
  );
}

export function Register() {
  const { account, status, getSigner, connect } = useWallet();
  const { participant, isAdmin, isVerified, role, isLoading, refetch } = useParticipant();
  const ipfs = useIpfsStatus();
  const tx = useTransaction();
  const qc = useQueryClient();
  const [profileNote, setProfileNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (v: RegistrationValues, photo: File | null) => {
    setSubmitError(null);
    setProfileNote(null);
    let signer;
    try {
      signer = await getSigner();
    } catch (e) {
      return setSubmitError((e as Error).message);
    }
    const receipt = await tx.run("Register participant", () => contracts(signer).userRegistry.registerUser(v.name, v.organization ?? "", v.location, RoleId[v.role]));
    if (!receipt) return;
    await qc.invalidateQueries({ queryKey: ["walletStatus"] });

    // Off-chain private profile (email / phone / photo) -> backend, after on-chain success.
    if (v.email || v.phone || photo) {
      try {
        const token = await ensureApiSession(signer);
        let photoCID = "";
        if (photo && ipfs.data?.configured) photoCID = (await api.uploadFile(token, photo)).cid;
        await api.registerProfile(token, { email: v.email, phone: v.phone, photoCID, txHash: receipt.hash });
        setProfileNote({ ok: true, text: "Private contact details saved off-chain." });
      } catch (e) {
        setProfileNote({ ok: false, text: `On-chain registration succeeded, but private contact details were not saved: ${(e as Error).message}` });
      }
    }
    refetch();
  };

  if (status !== "connected") {
    return (
      <div className="container max-w-lg py-20 text-center">
        <h1 className="text-2xl font-semibold text-ink">Participant registration</h1>
        <p className="mt-2 text-muted-foreground">Connect your wallet to register as a supply-chain participant.</p>
        <Button className="mt-6" onClick={connect}>Connect Wallet</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Participant registration" description="Your public profile is written to the UserRegistry contract. An administrator must verify you before you can act." />

      {isLoading ? null : participant ? (
        <Card>
          <CardHeader>
            <CardTitle>Registration status</CardTitle>
            <CardDescription>Read live from the blockchain for {account}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-lg font-semibold text-ink">{participant.name}</span>
              <VerificationBadge status={participant.verification} />
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{participant.role}</span>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Organization</dt><dd className="text-ink">{participant.organization || "—"}</dd></div>
              <div><dt className="text-muted-foreground">Location</dt><dd className="text-ink">{participant.location}</dd></div>
              <div><dt className="text-muted-foreground">Registered</dt><dd className="text-ink">{formatDateTime(participant.registeredAt)}</dd></div>
            </dl>
            {tx.state.hash && (
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">Registration transaction: <TxHashLink hash={tx.state.hash} /></p>
            )}
            {participant.verification === "Pending" && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                <Clock className="mt-0.5 h-4 w-4 shrink-0" /> Waiting for an administrator to verify your account. Your requested role grants no permissions until then.
              </div>
            )}
            {(participant.verification === "Rejected" || participant.verification === "Revoked") && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> Your registration was {participant.verification.toLowerCase()} by an administrator. Contact the platform operator.
              </div>
            )}
            {isVerified && (
              <Button asChild>
                <Link to={dashboardPath(role, isAdmin, true)}><CheckCircle2 /> Open my dashboard</Link>
              </Button>
            )}
            {profileNote && <p className={cn("text-sm", profileNote.ok ? "text-forest" : "text-amber-700")}>{profileNote.text}</p>}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-5">
            {isAdmin && (
              <p className="mb-4 flex items-start gap-2 rounded-lg bg-accent/60 p-3 text-sm text-forest">
                <Info className="mt-0.5 h-4 w-4 shrink-0" /> This wallet is an administrator. <Link to="/admin" className="font-medium underline">Open the admin console</Link>, or register a participant profile below.
              </p>
            )}
            <RegistrationForm onSubmit={onSubmit} disabled={tx.isBusy} ipfsConfigured={Boolean(ipfs.data?.configured)} />
            {submitError && <p role="alert" className="mt-3 text-sm text-destructive">{submitError}</p>}
            <TxStatusPanel state={tx.state} className="mt-5" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
