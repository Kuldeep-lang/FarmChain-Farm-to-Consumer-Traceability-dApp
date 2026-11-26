import { useQuery } from "@tanstack/react-query";
import type { Signer } from "ethers";
import { api, ensureApiSession } from "@/services/api";

export function useIpfsStatus() {
  return useQuery({ queryKey: ["ipfsStatus"], queryFn: api.ipfsStatus, staleTime: 60_000, retry: 1 });
}

export const MAX_FILE_MB = 10;
export const ACCEPTED_FILES = "image/jpeg,image/png,image/webp,application/pdf";

export function validateFile(file: File | null | undefined, maxMb = MAX_FILE_MB): string | null {
  if (!file) return null;
  if (!ACCEPTED_FILES.split(",").includes(file.type)) return "Only JPG, PNG, WebP or PDF files are allowed";
  if (file.size > maxMb * 1024 * 1024) return `File must be smaller than ${maxMb} MB`;
  return null;
}

/**
 * Uploads an optional document and/or notes for a supply-chain event to IPFS and returns the
 * CID to anchor on-chain ("" when nothing was provided).
 */
export async function uploadEventDocument(
  signer: Signer,
  opts: { batchId: number; kind: string; file?: File | null; notes?: string; extra?: Record<string, unknown>; ipfsConfigured: boolean },
): Promise<string> {
  // `extra` (e.g. the inspection result, which is also recorded on-chain) is only attached
  // when the user actually supplies notes or a file – it never forces an IPFS upload by itself.
  const hasNotes = Boolean(opts.notes?.trim());
  if (!opts.file && !hasNotes) return "";
  if (!opts.ipfsConfigured) throw new Error("IPFS is not configured on the server, so notes/documents cannot be stored. Remove them or configure Pinata.");
  const token = await ensureApiSession(signer);
  let fileCID: string | null = null;
  if (opts.file) fileCID = (await api.uploadFile(token, opts.file)).cid;
  if (!hasNotes && fileCID) return fileCID;
  const doc = {
    schema: "farmchain-event-v1",
    batchId: `FC-${opts.batchId}`,
    kind: opts.kind,
    notes: opts.notes?.trim() ?? "",
    documentCID: fileCID,
    ...opts.extra,
    recordedBy: (await signer.getAddress()).toLowerCase(),
    createdAt: new Date().toISOString(),
  };
  return (await api.uploadJson(token, `FC-${opts.batchId}-${opts.kind}`, doc)).cid;
}
