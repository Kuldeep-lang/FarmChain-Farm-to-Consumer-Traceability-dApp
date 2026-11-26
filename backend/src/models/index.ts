import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { ROLE_NAMES, STAGE_NAMES, VERIFICATION_NAMES } from "../utils/chainEnums.js";

/**
 * MongoDB is a NON-AUTHORITATIVE cache / search index. Every field marked "chain" is copied
 * from the contracts by the event indexer; the blockchain remains the source of truth.
 * Off-chain fields (email, phone, photo) are private profile data that must never go on-chain.
 */

// ---------------------------------------------------------------- Users
const userSchema = new Schema(
  {
    wallet: { type: String, required: true, unique: true, lowercase: true, index: true },
    // chain
    name: { type: String, default: "" },
    organization: { type: String, default: "" },
    location: { type: String, default: "" },
    role: { type: String, enum: ROLE_NAMES, default: "None" },
    verificationStatus: { type: String, enum: VERIFICATION_NAMES, default: "Pending" },
    roleActive: { type: Boolean, default: false },
    registeredOnChain: { type: Boolean, default: false },
    registeredAt: Date,
    registrationTx: String,
    lastSyncedAt: Date,
    // off-chain (private)
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    photoCID: { type: String, default: "" },
  },
  { timestamps: true },
);
userSchema.index({ role: 1, verificationStatus: 1 });
export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = mongoose.models.User || mongoose.model("User", userSchema);

// ---------------------------------------------------------------- Products (batches)
const productSchema = new Schema(
  {
    batchId: { type: Number, required: true, unique: true, index: true },
    farmer: { type: String, lowercase: true, index: true },
    productName: String,
    category: { type: String, index: true },
    quantity: Number,
    unit: String,
    harvestDate: Date,
    farmLocation: String,
    metadataCID: String,
    createdAt: Date,
    currentOwner: { type: String, lowercase: true, index: true },
    status: { type: String, enum: STAGE_NAMES, index: true },
    pendingTransferTo: { type: String, lowercase: true, default: null, index: true },
    participants: { type: [String], index: true }, // every wallet that held / was offered the batch
    registrationTx: String,
    lastEventBlock: Number,
    lastSyncedAt: Date,
  },
  { timestamps: { createdAt: "indexedAt", updatedAt: "updatedAt" } },
);
productSchema.index({ productName: "text", category: "text", farmLocation: "text" });
export const Product = mongoose.models.Product || mongoose.model("Product", productSchema);

// ---------------------------------------------------------------- Raw chain events
const chainEventSchema = new Schema(
  {
    txHash: { type: String, required: true, lowercase: true },
    logIndex: { type: Number, required: true },
    blockNumber: { type: Number, required: true, index: true },
    blockHash: { type: String, required: true },
    contract: { type: String, required: true },
    contractAddress: { type: String, lowercase: true },
    eventName: { type: String, required: true, index: true },
    args: { type: Schema.Types.Mixed, default: {} },
    batchId: { type: Number, index: true },
    orderId: Number,
    participants: { type: [String], index: true },
    sender: { type: String, lowercase: true },
    timestamp: Date,
  },
  { timestamps: true },
);
// Duplicate-indexing protection: one document per (txHash, logIndex).
chainEventSchema.index({ txHash: 1, logIndex: 1 }, { unique: true });
export const ChainEvent = mongoose.models.ChainEvent || mongoose.model("ChainEvent", chainEventSchema);

// ---------------------------------------------------------------- Transactions (one per tx)
const transactionSchema = new Schema(
  {
    hash: { type: String, required: true, unique: true, lowercase: true },
    blockNumber: { type: Number, index: true },
    from: { type: String, lowercase: true, index: true },
    to: { type: String, lowercase: true },
    contract: String,
    operation: { type: String, index: true },
    events: [String],
    batchId: { type: Number, index: true },
    orderId: Number,
    counterparty: { type: String, lowercase: true },
    participants: { type: [String], index: true },
    status: { type: String, enum: ["success", "failed"], default: "success" },
    timestamp: { type: Date, index: true },
  },
  { timestamps: true },
);
export const Transaction = mongoose.models.Transaction || mongoose.model("Transaction", transactionSchema);

// ---------------------------------------------------------------- Indexer state
const syncStateSchema = new Schema({
  key: { type: String, required: true, unique: true },
  chainId: Number,
  fingerprint: String, // contract addresses; a change triggers a full re-index
  lastBlock: Number,
  lastBlockHash: String,
  updatedAt: Date,
});
export const SyncState = mongoose.models.SyncState || mongoose.model("SyncState", syncStateSchema);

// ---------------------------------------------------------------- Wallet auth nonces
const nonceSchema = new Schema({
  wallet: { type: String, required: true, lowercase: true, index: true },
  nonce: { type: String, required: true, unique: true },
  message: { type: String, required: true },
  expiresAt: { type: Date, required: true },
});
nonceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const AuthNonce = mongoose.models.AuthNonce || mongoose.model("AuthNonce", nonceSchema);

// ---------------------------------------------------------------- Upload audit log
const uploadSchema = new Schema(
  {
    cid: { type: String, required: true, index: true },
    wallet: { type: String, lowercase: true, index: true },
    kind: { type: String, enum: ["file", "json"] },
    fileName: String,
    mimeType: String,
    size: Number,
    provider: String,
  },
  { timestamps: true },
);
export const Upload = mongoose.models.Upload || mongoose.model("Upload", uploadSchema);
