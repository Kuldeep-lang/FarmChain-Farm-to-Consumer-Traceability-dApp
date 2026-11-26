import type { Signer } from "ethers";
import { API_URL } from "@/blockchain/config";

/**
 * REST client for the FarmChain backend. The backend is a NON-AUTHORITATIVE index: anything
 * shown from it is labelled "indexed", while ownership / history / roles are read on-chain.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const tokenKey = (wallet: string) => `farmchain.api.${wallet.toLowerCase()}`;
const store = {
  get(k: string) {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
  del(k: string) {
    try {
      sessionStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

export const getApiToken = (wallet: string) => store.get(tokenKey(wallet));
export const clearApiSession = (wallet: string) => store.del(tokenKey(wallet));

async function request<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "Cannot reach the FarmChain API. Is the backend running?");
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`, body.details);
  return body as T;
}

const qs = (params: Record<string, unknown>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
};

/**
 * Wallet-signature login for API endpoints that need it (uploads, private profile data).
 * Signing costs no gas; it only proves wallet ownership to the API.
 */
export async function ensureApiSession(signer: Signer): Promise<string> {
  const wallet = (await signer.getAddress()).toLowerCase();
  const existing = getApiToken(wallet);
  if (existing) {
    try {
      await request("/auth/me", { token: existing });
      return existing;
    } catch {
      clearApiSession(wallet);
    }
  }
  const { message } = await request<{ message: string }>(`/auth/nonce${qs({ wallet })}`);
  const signature = await signer.signMessage(message);
  const { token } = await request<{ token: string }>("/auth/verify", { method: "POST", body: JSON.stringify({ wallet, message, signature }) });
  store.set(tokenKey(wallet), token);
  return token;
}

export interface Paged<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  source?: string;
}

export interface IndexedProduct {
  batchId: number;
  productName: string;
  category: string;
  quantity: number;
  unit: string;
  farmLocation: string;
  farmer: string;
  currentOwner: string;
  status: string;
  harvestDate: string;
  createdAt: string;
  metadataCID?: string;
}

export interface IndexedTransaction {
  hash: string;
  blockNumber: number;
  from: string;
  to?: string;
  contract?: string;
  operation: string;
  events: string[];
  batchId?: number;
  orderId?: number;
  counterparty?: string | null;
  status: "success" | "failed";
  timestamp: string;
}

export interface IndexedUser {
  wallet: string;
  name: string;
  organization: string;
  location: string;
  role: string;
  verificationStatus: string;
  registeredAt?: string;
  email?: string;
  phone?: string;
  photoCID?: string;
}

export interface IpfsStatus {
  provider: string;
  configured: boolean;
  maxUploadMb: number;
  allowed: string[];
}

export const api = {
  health: () => request<{ status: string; ipfs: { configured: boolean; provider: string }; indexer: { lastIndexedBlock: number | null } }>("/health"),
  stats: () =>
    request<{
      participants: number;
      verifiedParticipants: number;
      pendingVerifications: number;
      verifiedFarmers: number;
      distributors: number;
      batches: number;
      transactions: number;
      batchesByStatus: Record<string, number>;
      batchesByCategory: Record<string, number>;
    }>("/stats"),
  ipfsStatus: () => request<IpfsStatus>("/ipfs/status"),
  uploadFile: (token: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ cid: string; url: string; size: number; mimeType: string; name: string }>("/ipfs/upload", { method: "POST", body: form, token });
  },
  uploadJson: (token: string, name: string, data: Record<string, unknown>) =>
    request<{ cid: string; url: string }>("/ipfs/upload-json", { method: "POST", body: JSON.stringify({ name, data }), token }),
  registerProfile: (token: string, body: { email?: string; phone?: string; photoCID?: string; txHash?: string }) =>
    request<{ user: IndexedUser }>("/users/register", { method: "POST", body: JSON.stringify(body), token }),
  users: (params: { role?: string; status?: string; q?: string; page?: number; limit?: number }) => request<Paged<IndexedUser>>(`/users${qs(params)}`),
  user: (wallet: string, token?: string | null) => request<{ user: IndexedUser }>(`/users/${wallet}`, { token }),
  pendingVerifications: (token: string) => request<Paged<IndexedUser>>(`/admin/pending-verifications?limit=100`, { token }),
  adminParticipants: (token: string) => request<Paged<IndexedUser>>(`/admin/participants?limit=100`, { token }),
  products: (params: { page?: number; limit?: number; status?: string; farmer?: string; owner?: string; participant?: string }) =>
    request<Paged<IndexedProduct>>(`/products${qs(params)}`),
  searchProducts: (q: string, limit = 10) => request<Paged<IndexedProduct>>(`/products/search${qs({ q, limit })}`),
  productEvents: async (batchId: number) => (await request<{ items: { eventName: string; txHash: string; args: Record<string, string> }[] }>(`/products/${batchId}/events`)).items,
  transactions: (params: { page?: number; limit?: number; type?: string; batchId?: string; wallet?: string; from?: string; to?: string }) =>
    request<Paged<IndexedTransaction>>(`/transactions${qs(params)}`),
  transaction: (hash: string) => request<{ transaction: IndexedTransaction }>(`/transactions/${hash}`),
};
