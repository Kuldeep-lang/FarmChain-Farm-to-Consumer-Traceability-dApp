import { z } from "zod";
import { isAddress } from "ethers";
import { STAGE_NAMES, ROLE_NAMES, VERIFICATION_NAMES, parseBatchId } from "./chainEnums.js";

export const walletSchema = z
  .string()
  .trim()
  .refine((s) => isAddress(s), "Invalid wallet address")
  .transform((s) => s.toLowerCase());

export const batchIdSchema = z
  .string()
  .transform((s, ctx) => {
    const id = parseBatchId(s);
    if (id === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid batch ID (expected e.g. 10001 or FC-10001)" });
      return z.NEVER;
    }
    return id;
  });

export const txHashSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Invalid transaction hash")
  .transform((s) => s.toLowerCase());

export const cidSchema = z
  .string()
  .trim()
  .max(128)
  .regex(/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/, "Invalid IPFS CID");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const productListQuery = paginationSchema.extend({
  status: z.enum(STAGE_NAMES).optional(),
  farmer: walletSchema.optional(),
  owner: walletSchema.optional(),
  participant: walletSchema.optional(),
  category: z.string().trim().max(64).optional(),
});

export const productSearchQuery = paginationSchema.extend({
  q: z.string().trim().min(1, "Search query is required").max(100),
});

export const transactionListQuery = paginationSchema.extend({
  type: z.string().trim().max(64).optional(),
  batchId: batchIdSchema.optional(),
  wallet: walletSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const userListQuery = paginationSchema.extend({
  role: z.enum(ROLE_NAMES).optional(),
  status: z.enum(VERIFICATION_NAMES).optional(),
  q: z.string().trim().max(100).optional(),
});

export const registerProfileBody = z.object({
  email: z.string().trim().email("Invalid email").max(254).or(z.literal("")).default(""),
  phone: z
    .string()
    .trim()
    .regex(/^[+0-9 ()-]{6,20}$/, "Invalid phone number")
    .or(z.literal(""))
    .default(""),
  photoCID: cidSchema.or(z.literal("")).default(""),
  txHash: txHashSchema.optional(),
});

export const nonceQuery = z.object({ wallet: walletSchema });
export const verifyBody = z.object({
  wallet: walletSchema,
  message: z.string().min(10).max(2000),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "Invalid signature"),
});

export const uploadJsonBody = z.object({
  name: z.string().trim().min(1).max(100).default("farmchain-metadata"),
  data: z.record(z.unknown()).refine((d) => JSON.stringify(d).length <= 100_000, "Metadata too large (max 100 KB)"),
});

/** Escapes user input for safe use inside a MongoDB $regex. */
export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
