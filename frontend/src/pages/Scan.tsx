import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Camera, CameraOff, Hash, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@/components/ui/primitives";
import { EmptyState, SourceBadge, StageBadge } from "@/components/common";
import { api } from "@/services/api";
import { parseBatchId, formatBatchId, formatNumber } from "@/utils/format";
import type { StageName } from "@/blockchain/enums";

/** Camera QR scanner (html5-qrcode), manual batch ID entry and product search. */
export function Scan() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [batchInput, setBatchInput] = useState("");
  const [batchError, setBatchError] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [term, setTerm] = useState(params.get("q") ?? "");
  const [scanning, setScanning] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);

  const results = useQuery({ queryKey: ["search", term], queryFn: () => api.searchProducts(term, 20), enabled: term.trim().length > 0, retry: false });

  const stop = async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    if (s) {
      try {
        await s.stop();
        s.clear();
      } catch {
        /* already stopped */
      }
    }
    setScanning(false);
  };

  useEffect(() => () => void stop(), []);

  const start = async () => {
    setCamError(null);
    setScanning(true);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("qr-reader", { verbose: false });
      scannerRef.current = scanner as never;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded) => {
          const id = parseBatchId(decoded);
          if (id) {
            void stop();
            navigate(`/trace/${id}`);
          } else {
            setCamError("That QR code is not a FarmChain product code.");
          }
        },
        () => {},
      );
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      setCamError(
        /permission|notallowed/i.test(msg)
          ? "Camera permission was denied. Allow camera access in your browser settings, or enter the batch ID manually."
          : /notfound|no camera|devices/i.test(msg)
            ? "No camera was found on this device. Enter the batch ID manually instead."
            : /secure|https/i.test(msg)
              ? "The camera requires a secure (HTTPS or localhost) connection."
              : `Could not start the camera: ${msg}`,
      );
      await stop();
    }
  };

  const goBatch = (e: React.FormEvent) => {
    e.preventDefault();
    const id = parseBatchId(batchInput);
    if (!id) return setBatchError("Enter a valid batch ID, e.g. FC-10001");
    navigate(`/trace/${id}`);
  };

  return (
    <div className="container max-w-5xl py-12">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-ink">Trace a product</h1>
        <p className="mt-2 text-muted-foreground">Scan the FarmChain QR code on the package, enter its batch ID, or search by product name. No wallet needed.</p>
      </div>
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Camera className="h-4 w-4 text-secondary" /> Scan QR code</CardTitle>
            <CardDescription>Uses your device camera. Nothing is uploaded.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative overflow-hidden rounded-xl border bg-slate-950/95">
              <div id="qr-reader" className="min-h-[260px] w-full" />
              {!scanning && (
                <div className="absolute inset-0 grid place-items-center text-slate-400">
                  <div className="text-center">
                    <CameraOff className="mx-auto h-8 w-8" />
                    <p className="mt-2 text-sm">Camera is off</p>
                  </div>
                </div>
              )}
            </div>
            {camError && <p role="alert" className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">{camError}</p>}
            <div className="mt-4">
              {scanning ? <Button variant="outline" className="w-full" onClick={stop}><CameraOff /> Stop camera</Button> : <Button className="w-full" onClick={start}><Camera /> Start camera</Button>}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Hash className="h-4 w-4 text-secondary" /> Enter batch ID</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={goBatch} className="flex gap-2">
                <Input value={batchInput} onChange={(e) => { setBatchInput(e.target.value); setBatchError(null); }} placeholder="FC-10001" aria-label="Batch ID" aria-invalid={!!batchError} />
                <Button type="submit">Trace</Button>
              </form>
              {batchError && <p role="alert" className="mt-2 text-xs text-destructive">{batchError}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2"><Search className="h-4 w-4 text-secondary" /> Search products</CardTitle>
              <SourceBadge source="index" />
            </CardHeader>
            <CardContent>
              <form onSubmit={(e) => { e.preventDefault(); setTerm(search); }} className="flex gap-2">
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tomatoes, Coimbatore…" aria-label="Product name" />
                <Button type="submit" variant="secondary">Search</Button>
              </form>
              <p className="mt-2 text-xs text-muted-foreground">Search uses the backend index. Opening a result loads the verified record from the blockchain.</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {term && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold text-ink">Results for “{term}”</h2>
          {results.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</p>
          ) : results.isError ? (
            <p className="text-sm text-amber-700">Search is unavailable: {(results.error as Error).message}. You can still trace by batch ID.</p>
          ) : !results.data?.items.length ? (
            <EmptyState title="No products found" description="Try another name or enter the batch ID from the label." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {results.data.items.map((p) => (
                <Link key={p.batchId} to={`/trace/${p.batchId}`} className="rounded-xl border bg-white p-4 shadow-card transition hover:-translate-y-0.5 hover:shadow-lift">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-ink">{p.productName}</p>
                      <p className="mono text-xs text-muted-foreground">{formatBatchId(p.batchId)}</p>
                    </div>
                    <StageBadge stage={p.status as StageName} />
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{formatNumber(p.quantity)} {p.unit} · {p.farmLocation}</p>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
