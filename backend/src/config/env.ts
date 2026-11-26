import "dotenv/config";
import { z } from "zod";

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : ["1", "true", "yes"].includes(v.toLowerCase())));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  MONGODB_URI: z.string().default("mongodb://127.0.0.1:27017/farmchain"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_EXPIRES_IN: z.string().default("12h"),

  RPC_URL: z.string().url().default("http://127.0.0.1:8545"),
  CHAIN_ID: z.coerce.number().int().positive().default(31337),
  CONTRACT_ADDRESS_ROLE_MANAGER: optionalString,
  CONTRACT_ADDRESS_USER_REGISTRY: optionalString,
  CONTRACT_ADDRESS_PRODUCT_REGISTRY: optionalString,
  CONTRACT_ADDRESS_SUPPLY_CHAIN: optionalString,
  CONTRACT_ADDRESS_PAYMENT_ESCROW: optionalString,
  CONTRACT_ADDRESS_PAYMENT_TOKEN: optionalString,

  INDEXER_ENABLED: bool(true),
  INDEXER_POLL_INTERVAL_MS: z.coerce.number().int().min(500).default(4000),
  INDEXER_START_BLOCK: optionalString,
  INDEXER_CONFIRMATIONS: z.coerce.number().int().min(0).default(0),
  INDEXER_BLOCK_RANGE: z.coerce.number().int().min(1).default(500),

  IPFS_PROVIDER: z.enum(["pinata", "kubo", "none"]).default("pinata"),
  PINATA_JWT: optionalString,
  PINATA_GATEWAY: optionalString,
  KUBO_API_URL: z.string().default("http://127.0.0.1:5001"),
  IPFS_GATEWAY_URL: z.string().default("https://gateway.pinata.cloud/ipfs"),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(50).default(10),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid backend environment configuration:");
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
