import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { useParticipant } from "@/hooks/useParticipant";
import type { RoleName } from "@/blockchain/enums";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/primitives";

/**
 * UI-level guard for role-specific pages. This only improves UX – every write is enforced
 * independently by the smart contracts, so hiding a page is never the security boundary.
 */
export function RequireRole({ roles, admin, children }: { roles?: RoleName[]; admin?: boolean; children: ReactNode }) {
  const { isLoading, isVerified, role, isAdmin, participant, isError, error } = useParticipant();
  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </div>
    );
  }
  if (isError) {
    return <Denied title="Could not read your on-chain identity" message={(error as Error)?.message ?? "Blockchain unreachable"} />;
  }
  const allowed = admin ? isAdmin : isVerified && (!roles || roles.includes(role));
  if (!allowed) {
    const message = admin
      ? "This page requires the on-chain administrator role (DEFAULT_ADMIN_ROLE in RoleManager)."
      : !participant
        ? "Register this wallet as a participant first."
        : participant.verification !== "Verified"
          ? `Your registration is ${participant.verification.toLowerCase()}. An administrator must verify you before you can use this dashboard.`
          : `This page is for ${roles?.join(" / ")} accounts. Your on-chain role is ${role}.`;
    return <Denied title="Access restricted" message={message} />;
  }
  return <>{children}</>;
}

function Denied({ title, message }: { title: string; message: string }) {
  return (
    <div role="alert" className="mx-auto mt-10 max-w-lg rounded-xl border bg-white p-8 text-center shadow-card">
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-amber-50 text-amber-700">
        <Lock className="h-5 w-5" />
      </div>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <div className="mt-5 flex justify-center gap-2">
        <Button asChild variant="outline">
          <Link to="/connect">Go to my dashboard</Link>
        </Button>
        <Button asChild>
          <Link to="/register">Registration status</Link>
        </Button>
      </div>
    </div>
  );
}
