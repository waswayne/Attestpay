import { z } from "zod";
import { parseUsdcAmount } from "../../domain/payments/usdc-amount.js";
import {
  evmAddressSchema,
  transactionHashSchema,
} from "../../shared/validation/evm.js";
import type {
  SettlementVerifierPort,
  UsdcSettlementEvidence,
  VerifyUsdcSettlement,
} from "../ports/settlement-verifier.port.js";

const settlementSchema = z.object({
  transactionHash: transactionHashSchema,
  senderAddress: evmAddressSchema,
  recipientAddress: evmAddressSchema,
  amount: z.string(),
});

export async function verifyUsdcSettlement(
  verifier: SettlementVerifierPort,
  input: VerifyUsdcSettlement,
): Promise<UsdcSettlementEvidence> {
  const expected = settlementSchema.parse(input);
  parseUsdcAmount(expected.amount);
  return verifier.verifyUsdcSettlement(expected);
}
