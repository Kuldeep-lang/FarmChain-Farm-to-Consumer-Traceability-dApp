import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Download, ExternalLink, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { traceUrl } from "@/blockchain/config";
import { formatBatchId } from "@/utils/format";
import { cn } from "@/utils/cn";

/** SVG QR generation (works without <canvas>, so it is testable and crisp when printed). */
export async function generateQrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#14532D", light: "#FFFFFF" } });
}

async function svgToPng(svg: string, size = 1024): Promise<string> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, 0, 0, size, size);
  return canvas.toDataURL("image/png");
}

/**
 * QR label for a batch. The code only contains the public traceability URL – no wallet
 * credentials or private data.
 */
export function QRCodeCard({ batchId, productName, className, compact }: { batchId: number; productName?: string; className?: string; compact?: boolean }) {
  const url = traceUrl(batchId);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    generateQrSvg(url)
      .then((s) => alive && setSvg(s))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [url]);

  const download = async () => {
    if (!svg) return;
    const png = await svgToPng(svg);
    const a = document.createElement("a");
    a.href = png;
    a.download = `farmchain-${formatBatchId(batchId)}.png`;
    a.click();
  };

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <div className="print-area flex flex-col items-center rounded-xl border bg-white p-4 text-center">
        {svg ? (
          <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={`QR code for batch ${formatBatchId(batchId)}`} className={compact ? "h-40 w-40" : "h-52 w-52"} data-testid="qr-image" data-url={url} />
        ) : (
          <div className={cn("animate-pulse rounded bg-slate-100", compact ? "h-40 w-40" : "h-52 w-52")} />
        )}
        <p className="mt-2 text-sm font-semibold text-ink">{formatBatchId(batchId)}</p>
        {productName && <p className="text-xs text-muted-foreground">{productName}</p>}
        <p className="mt-1 text-[10px] text-muted-foreground">Scan to verify on FarmChain</p>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">Could not generate QR: {error}</p>}
      <p className="mono mt-3 max-w-full break-all text-center text-xs text-muted-foreground">{url}</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <Button size="sm" variant="outline" onClick={download} disabled={!svg}>
          <Download /> PNG
        </Button>
        <Button size="sm" variant="outline" onClick={() => window.print()} disabled={!svg}>
          <Printer /> Print
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <a href={url} target="_blank" rel="noreferrer">
            <ExternalLink /> Open
          </a>
        </Button>
      </div>
    </div>
  );
}
