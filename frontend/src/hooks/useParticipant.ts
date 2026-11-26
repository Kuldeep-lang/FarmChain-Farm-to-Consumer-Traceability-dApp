import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@/context/WalletContext";
import { fetchWalletStatus } from "@/blockchain/reads";
import { CONTRACTS_READY } from "@/blockchain/config";
import type { RoleName } from "@/blockchain/enums";

/** On-chain identity of the connected wallet: registration, role, verification, admin. */
export function useParticipant() {
  const { account, isCorrectNetwork, status } = useWallet();
  const q = useQuery({
    queryKey: ["walletStatus", account],
    queryFn: () => fetchWalletStatus(account!),
    enabled: Boolean(account) && isCorrectNetwork && CONTRACTS_READY,
    staleTime: 10_000,
  });
  const participant = q.data?.participant ?? null;
  const verified = participant?.verification === "Verified" && participant.roleActive;
  return {
    ...q,
    connected: status === "connected",
    account,
    participant,
    isAdmin: q.data?.isAdmin ?? false,
    isRegistered: Boolean(participant),
    isVerified: Boolean(verified),
    role: (participant?.role ?? "None") as RoleName,
  };
}

export const dashboardPath = (role: RoleName, isAdmin: boolean, verified: boolean) => {
  if (verified && role !== "None") return `/dashboard/${role.toLowerCase()}`;
  if (isAdmin) return "/admin";
  return "/register";
};
