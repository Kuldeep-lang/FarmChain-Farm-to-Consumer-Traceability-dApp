import type { Request, Response } from "express";
import type { z } from "zod";
import { databaseStatus } from "../config/db.js";
import { ChainEvent, Product, Transaction, Upload, User } from "../models/index.js";
import { issueNonce, verifySignature, type AuthConfig } from "../services/auth.js";
import type { ChainReader } from "../services/chain.js";
import { detectFileType, type IpfsProvider } from "../services/ipfs.js";
import type { EventIndexer } from "../indexer/eventIndexer.js";
import { HttpError } from "../utils/httpError.js";
import { v } from "../middleware/index.js";
import * as S from "../utils/schemas.js";

export interface AppDeps {
  ipfs: IpfsProvider;
  reader: ChainReader;
  indexer: EventIndexer | null;
  auth: AuthConfig;
  chainInfo: () => Promise<{ chainId: number; blockNumber: number } | null>;
  contracts: Record<string, string | undefined>;
  maxUploadMb: number;
}

const PUBLIC_USER_FIELDS = "wallet name organization location role verificationStatus roleActive registeredOnChain registeredAt registrationTx photoCID";

const page = <T>(items: T[], total: number, p: { page: number; limit: number }) => ({
  items,
  page: p.page,
  limit: p.limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / p.limit)),
});

// ====================================================================== health

export const healthController = (deps: AppDeps) => async (_req: Request, res: Response) => {
  let chain: { chainId: number; blockNumber: number } | null = null;
  try {
    chain = await deps.chainInfo();
  } catch {
    chain = null;
  }
  const db = databaseStatus();
  res.status(db === "connected" ? 200 : 503).json({
    status: db === "connected" ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    database: db,
    blockchain: chain ? { connected: true, ...chain } : { connected: false },
    contracts: deps.contracts,
    ipfs: { provider: deps.ipfs.name, configured: deps.ipfs.configured },
    indexer: deps.indexer ? await deps.indexer.status() : { running: false },
  });
};

// ====================================================================== auth

export const authController = (deps: AppDeps) => ({
  nonce: async (req: Request, res: Response) => {
    const { wallet } = v<typeof S.nonceQuery>(req, "query");
    res.json(await issueNonce(wallet, deps.auth));
  },
  verify: async (req: Request, res: Response) => {
    const { wallet, message, signature } = v<typeof S.verifyBody>(req, "body");
    const result = await verifySignature(wallet, message, signature, deps.auth);
    res.json({ ...result, expiresIn: deps.auth.jwtExpiresIn });
  },
  me: async (req: Request, res: Response) => {
    let isAdmin = false;
    try {
      isAdmin = await deps.reader.isAdmin(req.wallet!);
    } catch {
      /* chain unreachable */
    }
    res.json({ wallet: req.wallet, isAdmin });
  },
});

// ====================================================================== users

export const userController = (deps: AppDeps) => ({
  /**
   * Stores PRIVATE off-chain profile data (email/phone/photo) for a wallet that has already
   * registered ON-CHAIN. Role/name/verification are always read from the contracts.
   */
  register: async (req: Request, res: Response) => {
    const body = v<typeof S.registerProfileBody>(req, "body");
    const wallet = req.wallet!;
    const onChain = await deps.reader.getUser(wallet);
    if (!onChain) throw HttpError.badRequest("Wallet is not registered on-chain yet. Submit the registerUser() transaction first.");
    const user = await User.findOneAndUpdate(
      { wallet },
      {
        $set: {
          email: body.email,
          phone: body.phone,
          photoCID: body.photoCID,
          name: onChain.name,
          organization: onChain.organization,
          location: onChain.location,
          role: onChain.role,
          verificationStatus: onChain.verificationStatus,
          roleActive: onChain.roleActive,
          registeredOnChain: true,
          registeredAt: onChain.registeredAt,
          lastSyncedAt: new Date(),
          ...(body.txHash ? { registrationTx: body.txHash } : {}),
        },
      },
      { upsert: true, new: true },
    ).lean();
    res.status(201).json({ user, source: "chain+offchain" });
  },

  get: async (req: Request, res: Response) => {
    const { wallet } = v<z.ZodObject<{ wallet: typeof S.walletSchema }>>(req, "params");
    const self = req.wallet === wallet;
    let isAdmin = false;
    if (req.wallet && !self) {
      try {
        isAdmin = await deps.reader.isAdmin(req.wallet);
      } catch {
        /* ignore */
      }
    }
    const projection = self || isAdmin ? `${PUBLIC_USER_FIELDS} email phone` : PUBLIC_USER_FIELDS;
    const user = await User.findOne({ wallet }).select(projection).lean();
    if (!user || !(user as { registeredOnChain?: boolean }).registeredOnChain) throw HttpError.notFound("User not found");
    res.json({ user, source: "index" });
  },

  list: async (req: Request, res: Response) => {
    const q = v<typeof S.userListQuery>(req, "query");
    const filter: Record<string, unknown> = { registeredOnChain: true };
    if (q.role) filter.role = q.role;
    if (q.status) filter.verificationStatus = q.status;
    if (q.q) {
      const rx = new RegExp(S.escapeRegex(q.q), "i");
      filter.$or = [{ name: rx }, { organization: rx }, { location: rx }, { wallet: rx }];
    }
    const [items, total] = await Promise.all([
      User.find(filter).select(PUBLIC_USER_FIELDS).sort({ registeredAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      User.countDocuments(filter),
    ]);
    res.json(page(items, total, q));
  },
});

// ====================================================================== admin

export const adminController = () => ({
  pending: async (req: Request, res: Response) => {
    const q = v<typeof S.paginationSchema>(req, "query");
    const filter = { registeredOnChain: true, verificationStatus: "Pending" };
    const [items, total] = await Promise.all([
      User.find(filter).select(`${PUBLIC_USER_FIELDS} email phone`).sort({ registeredAt: 1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      User.countDocuments(filter),
    ]);
    res.json(page(items, total, q));
  },
  participants: async (req: Request, res: Response) => {
    const q = v<typeof S.userListQuery>(req, "query");
    const filter: Record<string, unknown> = { registeredOnChain: true };
    if (q.role) filter.role = q.role;
    if (q.status) filter.verificationStatus = q.status;
    const [items, total] = await Promise.all([
      User.find(filter).select(`${PUBLIC_USER_FIELDS} email phone`).sort({ registeredAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      User.countDocuments(filter),
    ]);
    res.json(page(items, total, q));
  },
});

// ====================================================================== stats (public, from index)

export const statsController = () => async (_req: Request, res: Response) => {
  const [participants, verified, pending, farmers, distributors, batches, transactions, byStatus, byCategory] = await Promise.all([
    User.countDocuments({ registeredOnChain: true }),
    User.countDocuments({ registeredOnChain: true, verificationStatus: "Verified" }),
    User.countDocuments({ registeredOnChain: true, verificationStatus: "Pending" }),
    User.countDocuments({ registeredOnChain: true, verificationStatus: "Verified", role: "Farmer" }),
    User.countDocuments({ registeredOnChain: true, role: "Distributor" }),
    Product.countDocuments({}),
    Transaction.countDocuments({}),
    Product.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Product.aggregate([{ $group: { _id: "$category", count: { $sum: 1 } } }]),
  ]);
  res.json({
    source: "index",
    participants,
    verifiedParticipants: verified,
    pendingVerifications: pending,
    verifiedFarmers: farmers,
    distributors,
    batches,
    transactions,
    batchesByStatus: Object.fromEntries(byStatus.map((s: { _id: string; count: number }) => [s._id, s.count])),
    batchesByCategory: Object.fromEntries(byCategory.map((s: { _id: string; count: number }) => [s._id, s.count])),
  });
};

// ====================================================================== ipfs

export const ipfsController = (deps: AppDeps) => ({
  status: (_req: Request, res: Response) => {
    res.json({ provider: deps.ipfs.name, configured: deps.ipfs.configured, maxUploadMb: deps.maxUploadMb, allowed: ["image/jpeg", "image/png", "image/webp", "application/pdf"] });
  },
  upload: async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) throw HttpError.badRequest('No file provided (multipart field name must be "file")');
    const sniffed = detectFileType(file.buffer);
    if (!sniffed || sniffed !== file.mimetype) {
      throw HttpError.badRequest("File content does not match its declared type (allowed: JPG, PNG, WebP, PDF)");
    }
    if (!deps.ipfs.configured) throw HttpError.unavailable("IPFS is not configured on the server (set PINATA_JWT or IPFS_PROVIDER=kubo)");
    const safeName = file.originalname.replace(/[^\w.\-]+/g, "_").slice(0, 100) || "upload";
    const result = await deps.ipfs.uploadFile(file.buffer, safeName, file.mimetype, { wallet: req.wallet! });
    await Upload.create({ cid: result.cid, wallet: req.wallet, kind: "file", fileName: safeName, mimeType: file.mimetype, size: file.size, provider: deps.ipfs.name });
    res.status(201).json({ cid: result.cid, url: deps.ipfs.gatewayUrl(result.cid), size: file.size, mimeType: file.mimetype, name: safeName });
  },
  uploadJson: async (req: Request, res: Response) => {
    const { name, data } = v<typeof S.uploadJsonBody>(req, "body");
    if (!deps.ipfs.configured) throw HttpError.unavailable("IPFS is not configured on the server (set PINATA_JWT or IPFS_PROVIDER=kubo)");
    const result = await deps.ipfs.uploadJson(data, name, { wallet: req.wallet! });
    await Upload.create({ cid: result.cid, wallet: req.wallet, kind: "json", fileName: name, mimeType: "application/json", size: result.size, provider: deps.ipfs.name });
    res.status(201).json({ cid: result.cid, url: deps.ipfs.gatewayUrl(result.cid), size: result.size });
  },
});

// ====================================================================== products

export const productController = (deps: AppDeps) => ({
  list: async (req: Request, res: Response) => {
    const q = v<typeof S.productListQuery>(req, "query");
    const filter: Record<string, unknown> = {};
    if (q.status) filter.status = q.status;
    if (q.farmer) filter.farmer = q.farmer;
    if (q.owner) filter.currentOwner = q.owner;
    if (q.participant) filter.participants = q.participant;
    if (q.category) filter.category = q.category;
    const [items, total] = await Promise.all([
      Product.find(filter).sort({ batchId: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      Product.countDocuments(filter),
    ]);
    res.json({ ...page(items, total, q), source: "index" });
  },

  search: async (req: Request, res: Response) => {
    const q = v<typeof S.productSearchQuery>(req, "query");
    const asId = /^(?:fc-)?(\d{1,12})$/i.exec(q.q);
    const rx = new RegExp(S.escapeRegex(q.q), "i");
    const filter = asId ? { $or: [{ batchId: Number(asId[1]) }, { productName: rx }] } : { $or: [{ productName: rx }, { category: rx }, { farmLocation: rx }] };
    const [items, total] = await Promise.all([
      Product.find(filter).sort({ batchId: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      Product.countDocuments(filter),
    ]);
    res.json({ ...page(items, total, q), source: "index" });
  },

  /** Index record plus a live on-chain read so clients can see whether the two agree. */
  get: async (req: Request, res: Response) => {
    const { batchId } = v<z.ZodObject<{ batchId: typeof S.batchIdSchema }>>(req, "params");
    const indexed = await Product.findOne({ batchId }).lean();
    let onChain = null;
    let chainError: string | null = null;
    try {
      onChain = await deps.reader.getBatch(batchId);
    } catch (e) {
      chainError = (e as Error).message;
    }
    if (!indexed && !onChain) throw HttpError.notFound(`Batch FC-${batchId} not found`);
    res.json({ product: indexed, onChain, chainError, source: "index+chain" });
  },

  events: async (req: Request, res: Response) => {
    const { batchId } = v<z.ZodObject<{ batchId: typeof S.batchIdSchema }>>(req, "params");
    const events = await ChainEvent.find({ batchId }).sort({ blockNumber: 1, logIndex: 1 }).lean();
    res.json({ items: events, source: "index" });
  },
});

// ====================================================================== transactions

export const transactionController = (deps: AppDeps) => ({
  list: async (req: Request, res: Response) => {
    const q = v<typeof S.transactionListQuery>(req, "query");
    const filter: Record<string, unknown> = {};
    if (q.type) filter.operation = q.type;
    if (q.batchId !== undefined) filter.batchId = q.batchId;
    if (q.wallet) filter.participants = q.wallet;
    if (q.from || q.to) filter.timestamp = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    const [items, total] = await Promise.all([
      Transaction.find(filter).sort({ blockNumber: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      Transaction.countDocuments(filter),
    ]);
    res.json({ ...page(items, total, q), source: "index" });
  },

  /** Looks up a hash; if unknown, verifies it on-chain and indexes it when it is ours. */
  get: async (req: Request, res: Response) => {
    const { hash } = v<z.ZodObject<{ hash: typeof S.txHashSchema }>>(req, "params");
    let tx = await Transaction.findOne({ hash }).lean();
    if (!tx && deps.indexer) {
      const result = await deps.indexer.indexTransaction(hash);
      if (result === "not_found") throw HttpError.notFound("Transaction not found on-chain");
      if (result === "unrelated") throw HttpError.notFound("Transaction is not a FarmChain transaction");
      tx = await Transaction.findOne({ hash }).lean();
    }
    if (!tx) throw HttpError.notFound("Transaction not found");
    const events = await ChainEvent.find({ txHash: hash }).sort({ logIndex: 1 }).lean();
    res.json({ transaction: tx, events, source: "index" });
  },
});
