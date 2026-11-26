import { randomBytes } from "node:crypto";
import jwt, { type SignOptions } from "jsonwebtoken";
import { getAddress, isAddress, verifyMessage } from "ethers";
import { AuthNonce } from "../models/index.js";
import { HttpError } from "../utils/httpError.js";

const NONCE_TTL_MS = 10 * 60 * 1000;

export interface AuthConfig {
  jwtSecret: string;
  jwtExpiresIn: string;
  chainId: number;
}

export interface TokenPayload {
  wallet: string; // lowercase
}

/** Sign-in message (EIP-4361 style). Signing it costs no gas and sends no transaction. */
export function buildSignInMessage(wallet: string, nonce: string, chainId: number, issuedAt: string) {
  return [
    "FarmChain wants you to sign in with your Ethereum account:",
    getAddress(wallet),
    "",
    "Sign in to the FarmChain API. This request will not trigger a blockchain transaction or cost any gas.",
    "",
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

export async function issueNonce(walletInput: string, cfg: AuthConfig) {
  if (!isAddress(walletInput)) throw HttpError.badRequest("Invalid wallet address");
  const wallet = walletInput.toLowerCase();
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = new Date().toISOString();
  const message = buildSignInMessage(wallet, nonce, cfg.chainId, issuedAt);
  await AuthNonce.create({ wallet, nonce, message, expiresAt: new Date(Date.now() + NONCE_TTL_MS) });
  return { nonce, message };
}

/**
 * Verifies a signed sign-in message. The nonce is consumed atomically (single use), so a
 * captured signature cannot be replayed.
 */
export async function verifySignature(walletInput: string, message: string, signature: string, cfg: AuthConfig) {
  if (!isAddress(walletInput)) throw HttpError.badRequest("Invalid wallet address");
  const wallet = walletInput.toLowerCase();
  const nonceMatch = /^Nonce: ([0-9a-f]{32})$/m.exec(message);
  if (!nonceMatch) throw HttpError.badRequest("Malformed sign-in message");

  const record = await AuthNonce.findOneAndDelete({ nonce: nonceMatch[1], wallet });
  if (!record || record.message !== message) throw HttpError.unauthorized("Unknown or already used nonce");
  if (record.expiresAt.getTime() < Date.now()) throw HttpError.unauthorized("Sign-in request expired");

  let recovered: string;
  try {
    recovered = verifyMessage(message, signature).toLowerCase();
  } catch {
    throw HttpError.unauthorized("Invalid signature");
  }
  if (recovered !== wallet) throw HttpError.unauthorized("Signature does not match wallet");

  const token = jwt.sign({ wallet } satisfies TokenPayload, cfg.jwtSecret, {
    expiresIn: cfg.jwtExpiresIn as SignOptions["expiresIn"],
    subject: wallet,
  });
  return { token, wallet };
}

export function verifyToken(token: string, secret: string): TokenPayload {
  try {
    const payload = jwt.verify(token, secret) as TokenPayload;
    if (!payload.wallet || !isAddress(payload.wallet)) throw new Error("bad payload");
    return { wallet: payload.wallet.toLowerCase() };
  } catch {
    throw HttpError.unauthorized("Invalid or expired session token");
  }
}
