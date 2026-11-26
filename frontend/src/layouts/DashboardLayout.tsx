import { useState, type ReactNode } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  AlertTriangle,
  Boxes,
  ClipboardList,
  Coins,
  Home,
  LayoutDashboard,
  Loader2,
  Menu,
  PlusCircle,
  ReceiptText,
  ScanLine,
  ShieldCheck,
  X,
} from "lucide-react";
import { Logo, NetworkPill, VerificationBadge } from "@/components/common";
import { WalletButton } from "@/components/WalletButton";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/context/WalletContext";
import { useParticipant } from "@/hooks/useParticipant";
import { CONTRACTS_READY, NETWORK } from "@/blockchain/config";
import type { RoleName } from "@/blockchain/enums";
import { cn } from "@/utils/cn";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

function navFor(role: RoleName, isAdmin: boolean, verified: boolean): NavItem[] {
  const items: NavItem[] = [];
  if (verified && role !== "None") items.push({ to: `/dashboard/${role.toLowerCase()}`, label: "Dashboard", icon: <LayoutDashboard /> });
  if (verified && role === "Farmer") {
    items.push({ to: "/batches/new", label: "Register batch", icon: <PlusCircle /> });
    items.push({ to: "/batches", label: "Batch management", icon: <Boxes /> });
  }
  if (verified) items.push({ to: "/payments", label: "Payments & escrow", icon: <Coins /> });
  if (isAdmin) items.push({ to: "/admin", label: "Admin console", icon: <ShieldCheck /> });
  items.push({ to: "/transactions", label: "Transactions", icon: <ReceiptText /> });
  items.push({ to: "/scan", label: "Scan / trace", icon: <ScanLine /> });
  if (!verified && !isAdmin) items.push({ to: "/register", label: "Registration", icon: <ClipboardList /> });
  return items;
}

function NetworkGate({ children }: { children: ReactNode }) {
  const { status, isCorrectNetwork, switchNetwork, error } = useWallet();
  if (!CONTRACTS_READY) {
    return (
      <div className="m-6 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        <p className="font-semibold">Contracts are not configured for chain {NETWORK.chainId}.</p>
        <p className="mt-1">Deploy the contracts (<code>npm run deploy:local</code>) so ABIs and addresses are exported to <code>frontend/src/abi</code>, then reload.</p>
      </div>
    );
  }
  if (status === "connected" && !isCorrectNetwork) {
    return (
      <div className="m-6 flex flex-col items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-6">
        <div className="flex items-center gap-2 font-semibold text-amber-800">
          <AlertTriangle className="h-5 w-5" /> MetaMask is connected to the wrong network
        </div>
        <p className="text-sm text-amber-800">FarmChain runs on {NETWORK.name} (chain ID {NETWORK.chainId}). Switch networks to continue.</p>
        <Button onClick={switchNetwork}>Switch to {NETWORK.name}</Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }
  return <>{children}</>;
}

export function DashboardLayout() {
  const { status, chainId } = useWallet();
  const { participant, isAdmin, isVerified, role, isLoading } = useParticipant();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  if (status === "disconnected" || status === "unavailable") return <Navigate to="/connect" state={{ from: location.pathname }} replace />;
  if (status === "connecting") {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Reconnecting wallet…</span>
      </div>
    );
  }

  const nav = navFor(role, isAdmin, isVerified);
  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-5">
        <Logo />
        <button className="rounded-md p-1.5 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="mx-4 mb-4 rounded-xl border bg-slate-50 p-3">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Reading on-chain identity…</div>
        ) : participant ? (
          <>
            <p className="truncate text-sm font-semibold text-ink">{participant.name}</p>
            <p className="truncate text-xs text-muted-foreground">{participant.organization || participant.location}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-ink ring-1 ring-border">{participant.role}</span>
              <VerificationBadge status={participant.verification} />
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{isAdmin ? "Administrator wallet" : "Not registered"}</p>
        )}
        {isAdmin && participant && <p className="mt-2 text-xs font-medium text-forest">Also an administrator</p>}
      </div>
      <nav className="flex-1 space-y-0.5 px-3" aria-label="Dashboard">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === "/batches"}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition [&_svg]:h-[18px] [&_svg]:w-[18px]",
                isActive ? "bg-accent text-forest" : "text-muted-foreground hover:bg-muted hover:text-ink",
              )
            }
          >
            {n.icon} {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t p-3">
        <NavLink to="/" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-ink">
          <Home className="h-[18px] w-[18px]" /> Public site
        </NavLink>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-white lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-night/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-lift">{sidebar}</aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b bg-white/85 px-4 backdrop-blur sm:px-6">
          <button className="rounded-md p-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex"><NetworkPill chainId={chainId} /></span>
            <WalletButton compact />
          </div>
        </header>
        <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
          <NetworkGate>
            <Outlet />
          </NetworkGate>
        </main>
      </div>
    </div>
  );
}
