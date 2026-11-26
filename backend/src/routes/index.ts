import { Router } from "express";
import { z } from "zod";
import {
  adminController,
  authController,
  healthController,
  ipfsController,
  productController,
  statsController,
  transactionController,
  userController,
  type AppDeps,
} from "../controllers/index.js";
import { limiters, optionalAuth, requireAuth, requireOnChainAdmin, uploadMiddleware, validate } from "../middleware/index.js";
import * as S from "../utils/schemas.js";

export function buildRouter(deps: AppDeps) {
  const r = Router();
  const auth = requireAuth(deps.auth.jwtSecret);
  const maybeAuth = optionalAuth(deps.auth.jwtSecret);
  const admin = requireOnChainAdmin(deps.reader);

  r.get("/health", healthController(deps));
  r.get("/stats", statsController());

  // --- wallet-signature authentication (optional API sessions; never replaces on-chain auth)
  const a = authController(deps);
  r.get("/auth/nonce", limiters.auth, validate({ query: S.nonceQuery }), a.nonce);
  r.post("/auth/verify", limiters.auth, validate({ body: S.verifyBody }), a.verify);
  r.get("/auth/me", auth, a.me);

  // --- users
  const u = userController(deps);
  r.post("/users/register", auth, validate({ body: S.registerProfileBody }), u.register);
  r.get("/users", validate({ query: S.userListQuery }), u.list);
  r.get("/users/:wallet", maybeAuth, validate({ params: z.object({ wallet: S.walletSchema }) }), u.get);

  // --- admin (on-chain admin role verified server-side)
  const ad = adminController();
  r.get("/admin/pending-verifications", auth, admin, validate({ query: S.paginationSchema }), ad.pending);
  r.get("/admin/participants", auth, admin, validate({ query: S.userListQuery }), ad.participants);

  // --- IPFS
  const i = ipfsController(deps);
  r.get("/ipfs/status", i.status);
  r.post("/ipfs/upload", limiters.upload, auth, uploadMiddleware(deps.maxUploadMb), i.upload);
  r.post("/ipfs/upload-json", limiters.upload, auth, validate({ body: S.uploadJsonBody }), i.uploadJson);

  // --- products (search index; /:batchId also returns a live chain read)
  const p = productController(deps);
  r.get("/products", validate({ query: S.productListQuery }), p.list);
  r.get("/products/search", validate({ query: S.productSearchQuery }), p.search);
  r.get("/products/:batchId", validate({ params: z.object({ batchId: S.batchIdSchema }) }), p.get);
  r.get("/products/:batchId/events", validate({ params: z.object({ batchId: S.batchIdSchema }) }), p.events);

  // --- transactions
  const t = transactionController(deps);
  r.get("/transactions", validate({ query: S.transactionListQuery }), t.list);
  r.get("/transactions/:hash", validate({ params: z.object({ hash: S.txHashSchema }) }), t.get);

  return r;
}
