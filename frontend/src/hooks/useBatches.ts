import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@/context/WalletContext";
import { fetchFarmerBatches, fetchOrders, fetchParticipantBatches } from "@/blockchain/reads";
import { api } from "@/services/api";

/** Batches the connected wallet owns / owned / was offered (on-chain). */
export function useMyBatches(kind: "farmer" | "participant" = "participant") {
  const { account } = useWallet();
  return useQuery({
    queryKey: ["batches", kind, account],
    queryFn: () => (kind === "farmer" ? fetchFarmerBatches(account!) : fetchParticipantBatches(account!)),
    enabled: Boolean(account),
    refetchInterval: 15_000,
  });
}

export function useMyOrders() {
  const { account } = useWallet();
  return useQuery({ queryKey: ["orders", account], queryFn: () => fetchOrders(account!), enabled: Boolean(account) });
}

/** Recent indexed transactions for the wallet (backend cache, labelled as such in the UI). */
export function useRecentTransactions(limit = 6) {
  const { account } = useWallet();
  return useQuery({
    queryKey: ["recentTx", account, limit],
    queryFn: () => api.transactions({ wallet: account!, limit }),
    enabled: Boolean(account),
    retry: false,
    refetchInterval: 15_000,
  });
}

/** Wallet → display name map from the participant directory (index). */
export function useParticipantNames() {
  return useQuery({
    queryKey: ["participantNames"],
    queryFn: async () => {
      const res = await api.users({ limit: 100 });
      const names: Record<string, string> = {};
      const roles: Record<string, string> = {};
      for (const u of res.items) {
        names[u.wallet.toLowerCase()] = u.name;
        roles[u.wallet.toLowerCase()] = u.role;
      }
      return { names, roles };
    },
    retry: false,
    staleTime: 60_000,
  });
}
