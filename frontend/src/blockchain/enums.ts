/** Mirrors FarmChainTypes.sol / SupplyChainTracker.sol / PaymentEscrow.sol. */
export const ROLES = ["None", "Farmer", "Distributor", "Warehouse", "Retailer"] as const;
export type RoleName = (typeof ROLES)[number];
export const RoleId: Record<Exclude<RoleName, "None">, number> = { Farmer: 1, Distributor: 2, Warehouse: 3, Retailer: 4 };

export const STAGES = [
  "HARVESTED",
  "REGISTERED",
  "IN_TRANSIT",
  "AT_WAREHOUSE",
  "QUALITY_CHECKED",
  "OUT_FOR_DELIVERY",
  "AT_RETAILER",
  "AVAILABLE_FOR_SALE",
  "SOLD",
  "RECALLED",
] as const;
export type StageName = (typeof STAGES)[number];
export const StageId = Object.fromEntries(STAGES.map((s, i) => [s, i])) as Record<StageName, number>;

export const STAGE_LABEL: Record<StageName, string> = {
  HARVESTED: "Harvested",
  REGISTERED: "Registered",
  IN_TRANSIT: "In transit",
  AT_WAREHOUSE: "At warehouse",
  QUALITY_CHECKED: "Quality checked",
  OUT_FOR_DELIVERY: "Out for delivery",
  AT_RETAILER: "At retailer",
  AVAILABLE_FOR_SALE: "Available for sale",
  SOLD: "Sold",
  RECALLED: "Recalled",
};

/** Consumer-facing lifecycle bucket. */
export function lifecycle(stage: StageName): "Active" | "Delivered" | "Sold" | "Recalled" {
  if (stage === "RECALLED") return "Recalled";
  if (stage === "SOLD") return "Sold";
  if (stage === "AT_RETAILER" || stage === "AVAILABLE_FOR_SALE") return "Delivered";
  return "Active";
}

export const VERIFICATION = ["Pending", "Verified", "Rejected", "Revoked"] as const;
export type VerificationName = (typeof VERIFICATION)[number];

export const ACTIONS = [
  "Harvested",
  "Registered",
  "TransferInitiated",
  "TransferAccepted",
  "TransferRejected",
  "TransferCancelled",
  "ShipmentRecorded",
  "WarehouseArrival",
  "QualityInspectionPassed",
  "QualityInspectionFailed",
  "RetailArrival",
  "OutForDelivery",
  "AvailableForSale",
  "Sold",
  "Recalled",
  "MetadataUpdated",
] as const;
export type ActionName = (typeof ACTIONS)[number];

export const ACTION_LABEL: Record<ActionName, string> = {
  Harvested: "Harvested",
  Registered: "Registered on blockchain",
  TransferInitiated: "Transfer initiated",
  TransferAccepted: "Custody accepted",
  TransferRejected: "Transfer rejected",
  TransferCancelled: "Transfer cancelled",
  ShipmentRecorded: "In transit",
  WarehouseArrival: "Received at warehouse",
  QualityInspectionPassed: "Quality inspection passed",
  QualityInspectionFailed: "Quality inspection failed",
  RetailArrival: "Received by retailer",
  OutForDelivery: "Out for delivery",
  AvailableForSale: "Available for sale",
  Sold: "Sold",
  Recalled: "Recalled",
  MetadataUpdated: "Metadata updated",
};

export const ORDER_STATUS = ["Created", "Funded", "Released", "Refunded", "Cancelled"] as const;
export type OrderStatusName = (typeof ORDER_STATUS)[number];

/** Who may receive custody from whom (mirrors SupplyChainTracker._isValidTransfer). */
export const TRANSFER_TARGETS: Record<Exclude<RoleName, "None">, Exclude<RoleName, "None">[]> = {
  Farmer: ["Distributor"],
  Distributor: ["Warehouse", "Retailer"],
  Warehouse: ["Retailer", "Distributor"],
  Retailer: [],
};

/** Human labels for transaction operations stored by the indexer. */
export const OPERATION_LABEL: Record<string, string> = {
  ...ACTION_LABEL,
  UserRegistered: "Participant registered",
  UserProfileUpdated: "Profile updated",
  ParticipantVerified: "Participant verified",
  ParticipantRejected: "Registration rejected",
  VerificationRevoked: "Verification revoked",
  ParticipantRoleGranted: "Role granted",
  ParticipantRoleRevoked: "Role revoked",
  BatchRegistered: "Batch registered",
  BatchMetadataUpdated: "Metadata updated",
  TransferInitiated: "Transfer initiated",
  TransferAccepted: "Transfer accepted",
  TransferRejected: "Transfer rejected",
  TransferCancelled: "Transfer cancelled",
  QualityInspectionRecorded: "Quality inspection",
  OrderCreated: "Order created",
  PaymentDeposited: "Payment deposited",
  PaymentReleased: "Payment released",
  PaymentRefunded: "Payment refunded",
  OrderCancelled: "Order cancelled",
  DeliveryConfirmed: "Delivery confirmed",
  TokenTransfer: "Token transfer",
  TokenApproval: "Token approval",
  Failed: "Failed transaction",
};
