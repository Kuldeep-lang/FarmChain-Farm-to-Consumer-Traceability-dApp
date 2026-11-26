import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { Code2, Menu, ScanLine, X } from "lucide-react";
import { Logo } from "@/components/common";
import { WalletButton } from "@/components/WalletButton";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";
import { NETWORK } from "@/blockchain/config";

const NAV = [
  { to: "/#how-it-works", label: "How it works" },
  { to: "/#features", label: "Features" },
  { to: "/scan", label: "Trace a product" },
  { to: "/transactions", label: "Transactions" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-white/85 backdrop-blur">
      <div className="container flex h-16 items-center justify-between gap-4">
        <Logo />
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((n) =>
            n.to.startsWith("/#") ? (
              <a key={n.to} href={n.to} className="rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:text-ink">
                {n.label}
              </a>
            ) : (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => cn("rounded-md px-3 py-2 text-sm transition hover:text-ink", isActive ? "text-ink font-medium" : "text-muted-foreground")}>
                {n.label}
              </NavLink>
            ),
          )}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <Button variant="ghost" size="icon" asChild aria-label="Scan a QR code">
            <Link to="/scan">
              <ScanLine />
            </Link>
          </Button>
          <WalletButton />
        </div>
        <button className="rounded-md p-2 md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu" aria-expanded={open}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <div className="border-t bg-white md:hidden">
          <nav className="container flex flex-col gap-1 py-3" aria-label="Mobile">
            {NAV.map((n) => (
              <a key={n.to} href={n.to} onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-sm text-ink hover:bg-muted">
                {n.label}
              </a>
            ))}
            <WalletButton className="mt-2 w-full [&>button]:w-full" />
          </nav>
        </div>
      )}
    </header>
  );
}

export function Footer() {
  return (
    <footer className="bg-ink-night text-slate-300">
      <div className="container grid gap-10 py-14 md:grid-cols-4">
        <div className="md:col-span-2">
          <Logo inverted />
          <p className="mt-4 max-w-sm text-sm text-slate-400">From Farm to Fork. Verified on Blockchain. FarmChain records who handled your food, where and when, in tamper-resistant smart contracts.</p>
          <p className="mt-4 text-xs text-slate-500">
            Blockchain records prove who declared each event and when. They do not by themselves prove physical product quality or origin; supporting documents are supplied by participants.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Platform</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link to="/scan" className="hover:text-white">Trace a product</Link></li>
            <li><Link to="/connect" className="hover:text-white">Participant login</Link></li>
            <li><Link to="/register" className="hover:text-white">Join as a participant</Link></li>
            <li><Link to="/transactions" className="hover:text-white">Transaction explorer</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Network</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-forest-600" /> {NETWORK.name} (chain {NETWORK.chainId})</li>
            <li>{NETWORK.explorer ? <a href={NETWORK.explorer} target="_blank" rel="noreferrer" className="hover:text-white">Block explorer</a> : "Local development network"}</li>
            <li className="flex items-center gap-1.5"><Code2 className="h-3.5 w-3.5" /> Open-source smart contracts</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="container flex flex-col justify-between gap-2 py-5 text-xs text-slate-500 sm:flex-row">
          <span>© {new Date().getFullYear()} FarmChain. Test networks only – no real funds.</span>
          <span>Built with Solidity, React & IPFS</span>
        </div>
      </div>
    </footer>
  );
}

export function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
