import { z } from "zod";
import { AUTHORIZATION_REFERENCE_PATTERN } from "../../domain/payments/authorization-reference.js";
import { evmAddressSchema } from "../../shared/validation/evm.js";
import type {
  SubmitMemoUsdcTransfer,
  TreasuryPaymentPort,
  TreasuryPaymentSubmission,
} from "../ports/treasury-payment.port.js";
import type { TreasuryWalletPort } from "../ports/treasury-wallet.port.js";
import { assertTreasuryCanPay } from "./assert-treasury-can-pay.js";

const memoTransferSchema = z.object({
  idempotencyKey: z.string().uuid(),
  destinationAddress: evmAddressSchema,
  amount: z.string(),
  reference: z.string().trim().min(1).max(255),
  authorizationReference: z
    .string()
    .regex(AUTHORIZATION_REFERENCE_PATTERN),
});

export async function submitTreasuryMemoTransfer(
  wallet: TreasuryWalletPort,
  payments: TreasuryPaymentPort,
  input: SubmitMemoUsdcTransfer,
): Promise<TreasuryPaymentSubmission> {
  const transfer = memoTransferSchema.parse(input);
  await assertTreasuryCanPay(
    wallet,
    transfer.destinationAddress,
    transfer.amount,
  );
  return payments.submitMemoUsdcTransfer(transfer);
}
