import { isHex } from "viem";
import { z } from "zod";
import { evmAddressSchema } from "../../shared/validation/evm.js";
import type {
  SubmitArcContractCall,
  TreasuryPaymentPort,
  TreasuryPaymentSubmission,
} from "../ports/treasury-payment.port.js";

const contractCallSchema = z.object({
  idempotencyKey: z.string().uuid(),
  contractAddress: evmAddressSchema,
  callData: z.string().refine(isHex).transform((value) => value as `0x${string}`),
  reference: z.string().trim().min(1).max(255),
});

export async function submitArcContractCall(
  payments: TreasuryPaymentPort,
  input: SubmitArcContractCall,
): Promise<TreasuryPaymentSubmission> {
  return payments.submitArcContractCall(contractCallSchema.parse(input));
}
