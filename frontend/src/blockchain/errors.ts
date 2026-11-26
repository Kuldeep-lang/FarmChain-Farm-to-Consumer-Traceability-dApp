import { combinedInterface } from "./contracts";

/** Friendly explanations for contract custom errors. */
const FRIENDLY: Record<string, string> = {
  AccessControlUnauthorizedAccount: "Your wallet does not have permission for this action.",
  NotAdmin: "Only a FarmChain administrator can do this.",
  NotRegistered: "This wallet is not registered on FarmChain.",
  AlreadyRegistered: "This wallet is already registered.",
  AlreadyVerified: "This participant is already verified.",
  NotVerified: "The participant is not verified by an administrator.",
  NotVerifiedFarmer: "Only verified farmers can do this. Wait for admin approval.",
  InvalidRole: "Please choose a participant role.",
  EmptyField: "A required field is empty.",
  FieldTooLong: "One of the fields is too long.",
  ReasonTooLong: "The reason is too long (max 256 characters).",
  BatchIdMismatch: "Another batch was registered at the same moment. Please retry.",
  BatchNotFound: "Batch not found.",
  DuplicateMetadata: "This metadata document was already used for another batch.",
  InvalidQuantity: "Quantity must be greater than zero.",
  InvalidHarvestDate: "Harvest date cannot be in the future.",
  NotBatchFarmer: "Only the farmer who registered this batch can do this.",
  MetadataLocked: "Metadata can only be changed while the batch is still at the farm.",
  NotBatchOwner: "You are not the current owner of this batch.",
  InvalidTransfer: "This transfer is not allowed (check the recipient's role and verification).",
  TransferAlreadyPending: "A transfer for this batch is already pending.",
  NoPendingTransfer: "There is no pending transfer for this batch.",
  NotTransferRecipient: "Only the intended recipient can respond to this transfer.",
  NotTransferSender: "Only the sender can cancel this transfer.",
  InvalidStageTransition: "This step is not valid for the batch's current stage.",
  BatchFinalized: "This batch has been sold or recalled and can no longer move.",
  RoleNotAllowed: "Your role is not allowed to perform this step.",
  EnforcedPause: "The contract is paused by the administrator.",
  InvalidAmount: "Amount must be greater than zero.",
  InvalidDeliveryWindow: "Delivery window must be between 1 hour and 180 days.",
  InvalidSeller: "The seller must be the batch's current owner and different from you.",
  BatchNotPurchasable: "This batch is sold or recalled.",
  ActiveOrderExists: "There is already an open order for this batch.",
  InvalidOrderStatus: "The order is not in the right state for this action.",
  NotBuyer: "Only the buyer can do this.",
  NotOrderParty: "Only the buyer or seller can do this.",
  DeliveryNotProven: "The buyer has not yet accepted custody of the batch on-chain.",
  RefundNotAvailable: "A refund is only available after the delivery deadline, if custody was never transferred.",
  FaucetCooldown: "Faucet cooldown active – try again later.",
  ERC20InsufficientBalance: "Insufficient fUSD balance.",
  ERC20InsufficientAllowance: "The escrow is not approved to spend enough fUSD.",
  UseParticipantRoleFunctions: "Participant roles must be granted via verification.",
};

export interface DecodedError {
  message: string;
  rejected: boolean;
  code?: string;
}

function findRevertData(err: unknown, depth = 0): string | null {
  if (!err || typeof err !== "object" || depth > 6) return null;
  const e = err as Record<string, unknown>;
  for (const key of ["data", "revert"]) {
    const v = e[key];
    if (typeof v === "string" && /^0x[0-9a-fA-F]{8,}$/.test(v)) return v;
    if (v && typeof v === "object" && typeof (v as { data?: unknown }).data === "string") {
      const d = (v as { data: string }).data;
      if (/^0x[0-9a-fA-F]{8,}$/.test(d)) return d;
    }
  }
  for (const key of ["error", "info", "cause"]) {
    const found = findRevertData(e[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/** Turns any wallet / RPC / contract error into a readable message. */
export function decodeError(err: unknown): DecodedError {
  const e = (err ?? {}) as { code?: unknown; message?: string; shortMessage?: string; reason?: string; info?: { error?: { code?: number } } };
  if (e.code === "ACTION_REJECTED" || e.code === 4001 || e.info?.error?.code === 4001 || /user (rejected|denied)/i.test(e.message ?? "")) {
    return { message: "Transaction rejected in your wallet.", rejected: true, code: "ACTION_REJECTED" };
  }
  const data = findRevertData(err);
  if (data) {
    try {
      const parsed = combinedInterface().parseError(data);
      if (parsed) {
        let msg = FRIENDLY[parsed.name] ?? `Contract error: ${parsed.name}`;
        if (parsed.name === "EmptyField" || parsed.name === "FieldTooLong") msg += ` (${parsed.args[0]})`;
        return { message: msg, rejected: false, code: parsed.name };
      }
    } catch {
      /* not one of ours */
    }
  }
  if (e.reason) return { message: e.reason, rejected: false };
  if (e.code === "INSUFFICIENT_FUNDS") return { message: "Not enough ETH to pay for gas.", rejected: false, code: "INSUFFICIENT_FUNDS" };
  if (e.code === "NETWORK_ERROR" || /failed to fetch|could not detect network/i.test(e.message ?? "")) {
    return { message: "Cannot reach the blockchain node. Is it running?", rejected: false, code: "NETWORK_ERROR" };
  }
  // ethers wraps unrecognised wallet errors as "could not coalesce error"; the real cause is nested inside.
  const inner = findInnerMessage(err);
  const text = `${e.message ?? ""} ${inner ?? ""}`;
  if (/insufficient funds/i.test(text)) {
    return { message: "Not enough ETH to pay for gas. Use a funded Hardhat test account.", rejected: false, code: "INSUFFICIENT_FUNDS" };
  }
  if (/nonce/i.test(text)) {
    return { message: "Nonce mismatch. If you restarted Hardhat, clear MetaMask activity data (Settings → Advanced).", rejected: false };
  }
  if (inner && /could not coalesce/i.test(e.shortMessage || e.message || "")) {
    return { message: `Wallet error: ${inner}`, rejected: false };
  }
  return { message: e.shortMessage || e.message || "Something went wrong.", rejected: false };
}

/** Digs the wallet's own error message out of nested ethers / MetaMask error objects. */
function findInnerMessage(err: unknown, depth = 0): string | null {
  if (!err || typeof err !== "object" || depth > 6) return null;
  const e = err as Record<string, unknown>;
  for (const key of ["error", "info", "cause", "data"]) {
    const v = e[key];
    if (v && typeof v === "object") {
      const deeper = findInnerMessage(v, depth + 1);
      if (deeper) return deeper;
      const m = (v as { message?: unknown }).message;
      if (typeof m === "string" && m && !/could not coalesce/i.test(m)) return m;
    }
  }
  return null;
}
