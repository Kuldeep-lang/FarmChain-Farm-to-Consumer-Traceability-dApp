import { PinataSDK } from "pinata";
import { HttpError } from "../utils/httpError.js";

export interface UploadResult {
  cid: string;
  size: number;
}

export interface IpfsProvider {
  readonly name: "pinata" | "kubo" | "none";
  readonly configured: boolean;
  uploadFile(data: Buffer, fileName: string, mimeType: string, meta?: Record<string, string>): Promise<UploadResult>;
  uploadJson(data: object, name: string, meta?: Record<string, string>): Promise<UploadResult>;
  gatewayUrl(cid: string): string;
}

const join = (base: string, cid: string) => `${base.replace(/\/+$/, "")}/${cid}`;

/** Pinata (hosted IPFS pinning). Secrets stay on the server; never sent to the browser. */
export class PinataProvider implements IpfsProvider {
  readonly name = "pinata" as const;
  readonly configured: boolean;
  private sdk: PinataSDK | null;

  constructor(
    jwt: string | undefined,
    private gateway: string | undefined,
    private publicGateway: string,
  ) {
    this.configured = Boolean(jwt);
    this.sdk = jwt ? new PinataSDK({ pinataJwt: jwt, pinataGateway: gateway }) : null;
  }

  private client(): PinataSDK {
    if (!this.sdk) throw HttpError.unavailable("IPFS is not configured: set PINATA_JWT in backend/.env");
    return this.sdk;
  }

  async uploadFile(data: Buffer, fileName: string, mimeType: string, meta: Record<string, string> = {}) {
    const file = new File([new Uint8Array(data)], fileName, { type: mimeType });
    const res = await this.client().upload.public.file(file).name(fileName).keyvalues({ app: "farmchain", ...meta });
    return { cid: res.cid, size: res.size };
  }

  async uploadJson(data: object, name: string, meta: Record<string, string> = {}) {
    const res = await this.client().upload.public.json(data).name(name).keyvalues({ app: "farmchain", ...meta });
    return { cid: res.cid, size: res.size };
  }

  gatewayUrl(cid: string) {
    return this.gateway ? `https://${this.gateway.replace(/^https?:\/\//, "")}/ipfs/${cid}` : join(this.publicGateway, cid);
  }
}

/** Local IPFS node (Kubo) over its HTTP RPC API – real IPFS without third-party credentials. */
export class KuboProvider implements IpfsProvider {
  readonly name = "kubo" as const;
  readonly configured = true;

  constructor(
    private apiUrl: string,
    private publicGateway: string,
  ) {}

  private async add(blob: Blob, fileName: string): Promise<UploadResult> {
    const form = new FormData();
    form.append("file", blob, fileName);
    let res: Response;
    try {
      res = await fetch(`${this.apiUrl.replace(/\/+$/, "")}/api/v0/add?pin=true&cid-version=1`, { method: "POST", body: form });
    } catch {
      throw HttpError.unavailable(`Cannot reach the IPFS (Kubo) node at ${this.apiUrl}`);
    }
    if (!res.ok) throw HttpError.unavailable(`IPFS node error: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { Hash: string; Size: string };
    return { cid: body.Hash, size: Number(body.Size) };
  }

  uploadFile(data: Buffer, fileName: string, mimeType: string) {
    return this.add(new Blob([new Uint8Array(data)], { type: mimeType }), fileName);
  }

  uploadJson(data: object, name: string) {
    return this.add(new Blob([JSON.stringify(data)], { type: "application/json" }), `${name}.json`);
  }

  gatewayUrl(cid: string) {
    return join(this.publicGateway, cid);
  }
}

export class DisabledIpfsProvider implements IpfsProvider {
  readonly name = "none" as const;
  readonly configured = false;
  constructor(private publicGateway: string) {}
  async uploadFile(): Promise<UploadResult> {
    throw HttpError.unavailable("IPFS uploads are disabled (IPFS_PROVIDER=none)");
  }
  async uploadJson(): Promise<UploadResult> {
    throw HttpError.unavailable("IPFS uploads are disabled (IPFS_PROVIDER=none)");
  }
  gatewayUrl(cid: string) {
    return join(this.publicGateway, cid);
  }
}

export function createIpfsProvider(cfg: {
  IPFS_PROVIDER: "pinata" | "kubo" | "none";
  PINATA_JWT?: string;
  PINATA_GATEWAY?: string;
  KUBO_API_URL: string;
  IPFS_GATEWAY_URL: string;
}): IpfsProvider {
  if (cfg.IPFS_PROVIDER === "kubo") return new KuboProvider(cfg.KUBO_API_URL, cfg.IPFS_GATEWAY_URL);
  if (cfg.IPFS_PROVIDER === "none") return new DisabledIpfsProvider(cfg.IPFS_GATEWAY_URL);
  return new PinataProvider(cfg.PINATA_JWT, cfg.PINATA_GATEWAY, cfg.IPFS_GATEWAY_URL);
}

/** Magic-byte sniffing so a renamed executable cannot be uploaded as "image/png". */
export function detectFileType(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.length >= 5 && buf.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  return null;
}
