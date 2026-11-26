/** Mirrors FarmChainTypes.sol / SupplyChainTracker.sol enums. Keep in sync with the contracts. */
export const ROLE_NAMES = ["None", "Farmer", "Distributor", "Warehouse", "Retailer"] as const;
export const STAGE_NAMES = [
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
export const VERIFICATION_NAMES = ["Pending", "Verified", "Rejected", "Revoked"] as const;
export const ACTION_NAMES = [
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
export const ORDER_STATUS_NAMES = ["Created", "Funded", "Released", "Refunded", "Cancelled"] as const;

export type StageName = (typeof STAGE_NAMES)[number];
export type RoleName = (typeof ROLE_NAMES)[number];
export type VerificationName = (typeof VERIFICATION_NAMES)[number];

export const formatBatchId = (id: number | bigint) => `FC-${id}`;

/** Accepts "10001", "FC-10001", "fc-10001". Returns null for anything else. */
export function parseBatchId(input: string): number | null {
  const m = /^(?:fc-)?(\d{1,12})$/i.exec(input.trim());
  return m ? Number(m[1]) : null;
}
