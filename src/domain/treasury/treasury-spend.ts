import { requireStableIdentifier } from "../shared/canonical-record.js";

export type TreasurySpendRecord = Readonly<{
  id: string;
  amountBaseUnits: bigint;
  currency: "USDC";
}>;

export function createTreasurySpendRecord(input: {
  id: string;
  amountBaseUnits: bigint;
  currency: string;
}): TreasurySpendRecord {
  const id = requireStableIdentifier(input.id, "Treasury-spend record ID");

  if (input.amountBaseUnits <= 0n) {
    throw new Error("Treasury-spend amount must be positive integer base units.");
  }
  if (input.currency.trim().toUpperCase() !== "USDC") {
    throw new Error("Canonical treasury-spend records support USDC only.");
  }

  return Object.freeze({
    id,
    amountBaseUnits: input.amountBaseUnits,
    currency: "USDC",
  });
}
