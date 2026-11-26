import type { ContractTransactionResponse, TransactionReceipt, Interface } from "ethers";
import { decodeError } from "@/blockchain/errors";

export interface BatchFormValues {
  productName: string;
  category: string;
  description?: string;
  quantity: number;
  unit: string;
  harvestDate: number; // unix seconds
  farmLocation: string;
  state: string;
  district: string;
  extraMetadata?: Record<string, string>;
}

export interface RegistrationDeps {
  farmer: string;
  ipfsConfigured: boolean;
  photo?: File | null;
  certificate?: File | null;
  getToken: () => Promise<string>;
  uploadFile: (token: string, file: File) => Promise<{ cid: string }>;
  uploadJson: (token: string, name: string, data: Record<string, unknown>) => Promise<{ cid: string }>;
  nextBatchId: () => Promise<bigint>;
  /** Sends registerBatch and resolves with the CONFIRMED receipt (or null on failure). */
  sendRegister: (expectedId: bigint, input: Record<string, unknown>) => Promise<TransactionReceipt | null>;
  registryInterface: Interface;
  onStep?: (step: RegistrationStep, detail?: string) => void;
  lastError?: () => string | undefined;
}

export type RegistrationStep = "validating" | "uploading_files" | "uploading_metadata" | "awaiting_tx" | "confirmed";

export interface RegistrationResult {
  batchId: number;
  txHash: string;
  metadataCID: string;
  imageCID: string | null;
  certificationCID: string | null;
  metadata: Record<string, unknown> | null;
}

export class RegistrationError extends Error {}

/**
 * Batch registration workflow (spec §7 page 5):
 *  1-3  upload photo / certificate to IPFS and collect CIDs
 *  4-5  build metadata that embeds the *actual* next batch ID, upload to IPFS
 *  6-7  call registerBatch(expectedId, …) and wait for confirmation
 *  8    read the batch ID from the BatchRegistered event
 * If another farmer took the expected ID first (BatchIdMismatch) the metadata is rebuilt once.
 */
export async function registerBatchFlow(values: BatchFormValues, deps: RegistrationDeps): Promise<RegistrationResult> {
  const step = deps.onStep ?? (() => {});
  step("validating");
  const hasFiles = Boolean(deps.photo || deps.certificate);
  if (hasFiles && !deps.ipfsConfigured) {
    throw new RegistrationError("IPFS is not configured on the server, so files cannot be uploaded. Remove the files or configure Pinata.");
  }

  let token: string | null = null;
  let imageCID: string | null = null;
  let certificationCID: string | null = null;

  if (deps.ipfsConfigured) {
    token = await deps.getToken();
    if (hasFiles) {
      step("uploading_files");
      if (deps.photo) imageCID = (await deps.uploadFile(token, deps.photo)).cid;
      if (deps.certificate) certificationCID = (await deps.uploadFile(token, deps.certificate)).cid;
    }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const expectedId = await deps.nextBatchId();
    let metadataCID = "";
    let metadata: Record<string, unknown> | null = null;

    if (deps.ipfsConfigured && token) {
      step("uploading_metadata");
      metadata = {
        schema: "farmchain-batch-v1",
        batchId: `FC-${expectedId}`,
        productName: values.productName,
        category: values.category,
        description: values.description ?? "",
        quantity: values.quantity,
        unit: values.unit,
        harvestDate: new Date(values.harvestDate * 1000).toISOString().slice(0, 10),
        farmLocation: values.farmLocation,
        state: values.state,
        district: values.district,
        farmerWallet: deps.farmer,
        imageCID,
        certificationCID,
        additional: values.extraMetadata ?? {},
        createdAt: new Date().toISOString(),
      };
      metadataCID = (await deps.uploadJson(token, `FC-${expectedId}-metadata`, metadata)).cid;
    }

    step("awaiting_tx");
    const receipt = await deps.sendRegister(expectedId, {
      productName: values.productName,
      category: values.category,
      quantity: BigInt(values.quantity),
      unit: values.unit,
      harvestDate: BigInt(values.harvestDate),
      farmLocation: values.farmLocation,
      metadataCID,
    });

    if (receipt) {
      let batchId: number | null = null;
      for (const log of receipt.logs) {
        try {
          const parsed = deps.registryInterface.parseLog(log);
          if (parsed?.name === "BatchRegistered") batchId = Number(parsed.args.batchId);
        } catch {
          /* other contract */
        }
      }
      if (batchId === null) throw new RegistrationError("Transaction confirmed but no BatchRegistered event was found.");
      step("confirmed");
      return { batchId, txHash: receipt.hash, metadataCID, imageCID, certificationCID, metadata };
    }

    const err = deps.lastError?.();
    if (err !== "BatchIdMismatch" || attempt === 1) throw new RegistrationError("Batch registration transaction did not succeed.");
    // retry: someone else registered first; rebuild metadata with the new ID
  }
  throw new RegistrationError("Batch registration failed.");
}

/** Convenience to wrap a contract call promise for useTransaction. */
export type Sender = () => Promise<ContractTransactionResponse>;
export { decodeError };
