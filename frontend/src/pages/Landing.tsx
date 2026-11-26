import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BadgeCheck,
  Blocks,
  Boxes,
  ClipboardCheck,
  Coins,
  Database,
  FileLock2,
  Fingerprint,
  QrCode,
  ScanLine,
  Search,
  ShieldCheck,
  Sprout,
  Store,
  Truck,
  User,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Input } from "@/components/ui/primitives";
import { api } from "@/services/api";
import { parseBatchId, formatNumber } from "@/utils/format";
import { NETWORK } from "@/blockchain/config";
import { cn } from "@/utils/cn";

const JOURNEY = [
  { icon: <Sprout />, title: "Farmer", text: "Registers the harvest batch with photos and certificates" },
  { icon: <Truck />, title: "Distributor", text: "Accepts custody and records transport details" },
  { icon: <Warehouse />, title: "Warehouse", text: "Confirms storage conditions and quality inspection" },
  { icon: <Store />, title: "Retailer", text: "Confirms delivery and puts the produce on sale" },
  { icon: <User />, title: "Consumer", text: "Scans the QR code and verifies the whole journey" },
];

const STEPS = [
  { n: "01", icon: <Fingerprint />, title: "Verified participants", text: "Farmers, distributors, warehouses and retailers connect a wallet and are approved by an administrator. Roles are enforced by smart contracts." },
  { n: "02", icon: <Boxes />, title: "Digital batch identity", text: "Each harvest gets a unique on-chain batch ID. Photos and certificates go to IPFS, and their content hashes are anchored on-chain." },
  { n: "03", icon: <Truck />, title: "Two-step custody transfers", text: "Every handover must be explicitly accepted by the receiver, creating a permanent, ordered chain of custody." },
  { n: "04", icon: <QrCode />, title: "Scan to verify", text: "A QR code on the product opens a public page that reads the history straight from the blockchain. No wallet needed." },
];

const FEATURES = [
  { icon: <ShieldCheck />, title: "Role-based access control", text: "OpenZeppelin AccessControl in a single RoleManager contract. Users cannot grant themselves privileges." },
  { icon: <Blocks />, title: "Immutable event history", text: "Append-only history with actor, location, timestamp and document hash for every stage." },
  { icon: <Coins />, title: "Escrow payments", text: "ERC-20 escrow releases funds when delivery is confirmed or custody is accepted on-chain." },
  { icon: <FileLock2 />, title: "Decentralised documents", text: "Certificates and inspection reports stored on IPFS via Pinata; secrets never touch the browser." },
  { icon: <ClipboardCheck />, title: "Quality inspections", text: "Warehouses record pass/fail inspections with signed, timestamped reports." },
  { icon: <Database />, title: "Searchable index", text: "A backend indexer caches events for fast search, while the chain stays the source of truth." },
];

function Stat({ label, value, loading }: { label: string; value: ReactNode; loading: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <p className={cn("text-3xl font-semibold tracking-tight text-white", loading && "animate-pulse text-white/40")}>{loading ? "···" : value}</p>
      <p className="mt-1 text-sm text-slate-400">{label}</p>
    </div>
  );
}

export function Landing() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.stats, retry: 1, refetchInterval: 30_000 });

  const trace = (e: React.FormEvent) => {
    e.preventDefault();
    const id = parseBatchId(query);
    navigate(id ? `/trace/${id}` : `/scan?q=${encodeURIComponent(query)}`);
  };

  return (
    <div>
      {/* ------------------------------------------------ Hero */}
      <section className="relative overflow-hidden border-b bg-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_10%,#DCFCE7_0,transparent_45%)]" />
        <div className="container relative grid items-center gap-12 py-16 lg:grid-cols-2 lg:py-24">
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-2 rounded-full border border-forest-100 bg-forest-50 px-3 py-1 text-xs font-medium text-forest">
              <BadgeCheck className="h-3.5 w-3.5" /> From Farm to Fork. Verified on Blockchain.
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-[1.08] tracking-tight text-ink sm:text-5xl lg:text-6xl">
              Know Your Food.
              <br />
              <span className="text-forest">Trust Its Journey.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">
              FarmChain brings transparency to agriculture through blockchain-powered supply-chain tracking. Follow every product from the farmer's field to your table.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link to="/scan">
                  <Search /> Explore Products
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/connect">
                  Get Started <ArrowRight />
                </Link>
              </Button>
            </div>
            <form onSubmit={trace} className="mt-8 flex max-w-md gap-2" role="search">
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Batch ID (e.g. FC-10001) or product name" aria-label="Batch ID or product" />
              <Button type="submit" variant="secondary">Trace</Button>
            </form>
          </div>

          {/* Product card mock built from real UI pieces */}
          <div className="relative mx-auto w-full max-w-md animate-fade-up [animation-delay:120ms]">
            <Card className="relative z-10 overflow-hidden p-0 shadow-lift">
              <div className="flex items-center justify-between border-b bg-slate-50 px-5 py-3">
                <span className="text-xs font-medium text-muted-foreground">Traceability preview</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-forest">
                  <ShieldCheck className="h-3 w-3" /> On-chain
                </span>
              </div>
              <div className="space-y-4 p-5">
                {JOURNEY.slice(0, 4).map((j, i) => (
                  <div key={j.title} className="flex items-center gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-forest [&_svg]:h-4 [&_svg]:w-4">{j.icon}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink">{["Harvested & registered", "Collected · in transit", "Stored · quality checked", "Available for sale"][i]}</p>
                      <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                        <div className="h-1.5 rounded-full bg-secondary" style={{ width: `${100 - i * 12}%` }} />
                      </div>
                    </div>
                    <BadgeCheck className="h-4 w-4 text-secondary" />
                  </div>
                ))}
              </div>
              <p className="border-t bg-slate-50 px-5 py-2 text-[11px] text-muted-foreground">Illustration. Real journeys load from the smart contracts on /trace/&lt;batch&gt;.</p>
            </Card>
            <div className="absolute -right-6 -top-6 hidden h-32 w-32 rounded-3xl bg-forest-100 sm:block" />
            <div className="absolute -bottom-6 -left-6 hidden h-24 w-24 rounded-3xl border-2 border-dashed border-forest-600/40 sm:block" />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ How it works */}
      <section id="how-it-works" className="container scroll-mt-20 py-20">
        <p className="section-eyebrow">How FarmChain works</p>
        <h2 className="mt-2 max-w-2xl text-3xl font-bold tracking-tight text-ink">A shared, tamper-resistant record for everyone who handles your food</h2>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <Card key={s.n} className="p-6">
              <div className="flex items-center justify-between">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-forest [&_svg]:h-5 [&_svg]:w-5">{s.icon}</div>
                <span className="mono text-sm text-slate-300">{s.n}</span>
              </div>
              <h3 className="mt-4 font-semibold text-ink">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.text}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ Journey visualisation */}
      <section className="border-y bg-white py-20">
        <div className="container">
          <p className="section-eyebrow text-center">The supply-chain journey</p>
          <h2 className="mt-2 text-center text-3xl font-bold tracking-tight text-ink">Farmer → Distributor → Warehouse → Retailer → Consumer</h2>
          <div className="relative mt-14 grid gap-8 md:grid-cols-5">
            <svg className="absolute left-[10%] right-[10%] top-8 hidden h-2 w-[80%] md:block" preserveAspectRatio="none" viewBox="0 0 100 2" aria-hidden>
              <line x1="0" y1="1" x2="100" y2="1" stroke="#16A34A" strokeWidth="0.6" strokeDasharray="2 2" className="animate-dash" />
            </svg>
            {JOURNEY.map((j, i) => (
              <div key={j.title} className="relative flex flex-col items-center text-center">
                <div className={cn("relative z-10 grid h-16 w-16 place-items-center rounded-2xl ring-8 ring-white [&_svg]:h-7 [&_svg]:w-7", i === 4 ? "bg-forest text-white" : "bg-accent text-forest")}>{j.icon}</div>
                <p className="mt-4 font-semibold text-ink">{j.title}</p>
                <p className="mt-1 max-w-[12rem] text-sm text-muted-foreground">{j.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ Features */}
      <section id="features" className="container scroll-mt-20 py-20">
        <p className="section-eyebrow">Platform features</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink">Built for trust from the contract up</h2>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border bg-white p-6 transition hover:-translate-y-0.5 hover:shadow-lift">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-forest text-forest-100 [&_svg]:h-5 [&_svg]:w-5">{f.icon}</div>
              <h3 className="mt-4 font-semibold text-ink">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ Transparency explanation */}
      <section className="border-y bg-white py-20">
        <div className="container grid gap-10 lg:grid-cols-2">
          <div>
            <p className="section-eyebrow">Blockchain transparency</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink">What is verified, and what isn't</h2>
            <p className="mt-4 text-muted-foreground">
              FarmChain is honest about what a blockchain can prove. Every page clearly separates records verified on-chain from documents supplied by participants.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="border-forest-100 p-5">
              <p className="flex items-center gap-2 font-semibold text-forest"><ShieldCheck className="h-4 w-4" /> On-chain verified</p>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>• Which verified wallet recorded each event</li>
                <li>• The exact time it was recorded</li>
                <li>• The order of custody transfers</li>
                <li>• That documents were not altered (content hash)</li>
              </ul>
            </Card>
            <Card className="border-amber-200 p-5">
              <p className="flex items-center gap-2 font-semibold text-amber-700"><FileLock2 className="h-4 w-4" /> Participant-supplied</p>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>• Physical product quality</li>
                <li>• Farm origin claims and certificates</li>
                <li>• Storage temperature readings</li>
                <li>• Photos and inspection notes</li>
              </ul>
            </Card>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ QR section */}
      <section className="container py-20">
        <div className="grid items-center gap-10 rounded-2xl border bg-white p-8 shadow-card md:grid-cols-[1fr_auto] md:p-12">
          <div>
            <p className="section-eyebrow">For consumers</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink">Scan the QR code on your produce</h2>
            <p className="mt-3 max-w-xl text-muted-foreground">No app, no wallet, no sign-up. Point your phone camera at the FarmChain label to see where your food came from and who handled it, with links to every blockchain transaction.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild>
                <Link to="/scan"><ScanLine /> Open scanner</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/scan">Enter batch ID</Link>
              </Button>
            </div>
          </div>
          <div className="mx-auto grid h-40 w-40 place-items-center rounded-2xl bg-forest text-forest-100">
            <QrCode className="h-20 w-20" />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ Stats (real data only) */}
      <section className="bg-ink-night py-20">
        <div className="container">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div>
              <p className="section-eyebrow text-forest-600">Live network statistics</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-white">FarmChain on {NETWORK.name}</h2>
            </div>
            <p className="text-xs text-slate-400">
              {stats.isError ? "Statistics unavailable (backend offline). No sample numbers are shown." : "Live counts from the FarmChain event index (a cache of on-chain events)."}
            </p>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Registered batches" value={stats.data ? formatNumber(stats.data.batches) : "—"} loading={stats.isLoading} />
            <Stat label="Verified participants" value={stats.data ? formatNumber(stats.data.verifiedParticipants) : "—"} loading={stats.isLoading} />
            <Stat label="Verified farmers" value={stats.data ? formatNumber(stats.data.verifiedFarmers) : "—"} loading={stats.isLoading} />
            <Stat label="Blockchain transactions" value={stats.data ? formatNumber(stats.data.transactions) : "—"} loading={stats.isLoading} />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ CTA */}
      <section className="container py-20">
        <div className="relative overflow-hidden rounded-2xl bg-forest px-8 py-14 text-center md:px-16">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-forest-700" />
          <h2 className="relative text-3xl font-bold tracking-tight text-white">Join the transparent food supply chain</h2>
          <p className="relative mx-auto mt-3 max-w-xl text-forest-100">Register as a farmer, distributor, warehouse operator or retailer. Connect your wallet and get verified.</p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Button size="lg" variant="inverted" asChild>
              <Link to="/connect">Get Started <ArrowRight /></Link>
            </Button>
            <Button size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10" asChild>
              <Link to="/scan">Trace a product</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
