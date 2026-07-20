import { isHex } from "viem";
import { z } from "zod";
import { parseUsdcAmount } from "../../domain/payments/usdc-amount.js";
import {
  evmAddressSchema,
  transactionHashSchema,
} from "../../shared/validation/evm.js";
import type {
  MemoUsdcSettlementEvidence,
  SettlementVerifierPort,
  VerifyMemoUsdcSettlement,
} from "../ports/settlement-verifier.port.js";

const hexBytesSchema = z.string().refine(isHex).transform((value) => value as `0x${string}`);

const memoSettlementSchema = z.object({
  transactionHash: transactionHashSchema,
  senderAddress: evmAddressSchema,
  recipientAddress: evmAddressSchema,
  amount: z.string(),
  memoId: transactionHashSchema,
  memoData: hexBytesSchema,
  transferCallDataHash: transactionHashSchema,
});

export async function verifyMemoUsdcSettlement(
  verifier: SettlementVerifierPort,
  input: VerifyMemoUsdcSettlement,
): Promise<MemoUsdcSettlementEvidence> {
  const expected = memoSettlementSchema.parse(input);
  parseUsdcAmount(expected.amount);
  return verifier.verifyMemoUsdcSettlement(expected);
}
