import { z } from "zod";
import { parseUsdcAmount } from "../../domain/payments/usdc-amount.js";
import { evmAddressSchema } from "../../shared/validation/evm.js";
import type {
  SubmitUsdcTransfer,
  TreasuryPaymentPort,
  TreasuryPaymentSubmission,
} from "../ports/treasury-payment.port.js";
import type { TreasuryWalletPort } from "../ports/treasury-wallet.port.js";

const transferSchema = z.object({
  idempotencyKey: z.string().uuid(),
  destinationAddress: evmAddressSchema,
  amount: z.string(),
  reference: z.string().trim().min(1).max(255),
});

export async function submitTreasuryTransfer(
  wallet: TreasuryWalletPort,
  payments: TreasuryPaymentPort,
  input: SubmitUsdcTransfer,
): Promise<TreasuryPaymentSubmission> {
  const transfer = transferSchema.parse(input);
  const requestedAmount = parseUsdcAmount(transfer.amount);
  const [details, balances] = await Promise.all([
    wallet.getDetails(),
    wallet.listBalances(),
  ]);

  if (details.state !== "LIVE") {
    throw new Error("Treasury wallet is not live; payment submission is blocked.");
  }

  if (
    details.address.toLowerCase() === transfer.destinationAddress.toLowerCase()
  ) {
    throw new Error("Treasury cannot pay its own address.");
  }

  const usdcBalance = balances.find(
    (balance) =>
      balance.symbol?.toUpperCase() === "USDC" && balance.isNative === false,
  );

  if (!usdcBalance) {
    throw new Error("Treasury has no canonical ERC-20 USDC balance.");
  }

  if (parseUsdcAmount(usdcBalance.amount) < requestedAmount) {
    throw new Error("Treasury has insufficient USDC for this payment.");
  }

  return payments.submitUsdcTransfer(transfer);
}
