export type TreasuryTransactionState =
  | "INITIATED"
  | "CLEARED"
  | "QUEUED"
  | "SENT"
  | "CONFIRMED"
  | "COMPLETE"
  | "STUCK"
  | "FAILED"
  | "DENIED"
  | "CANCELLED";

export type SubmitUsdcTransfer = Readonly<{
  idempotencyKey: string;
  destinationAddress: `0x${string}`;
  amount: string;
  reference: string;
}>;

export type SubmitMemoUsdcTransfer = SubmitUsdcTransfer &
  Readonly<{
    authorizationReference: string;
  }>;

export type TreasuryPaymentSubmission = Readonly<{
  transactionId: string;
  state: TreasuryTransactionState;
}>;

export type TreasuryPaymentStatus = TreasuryPaymentSubmission &
  Readonly<{
    transactionHash: `0x${string}` | null;
    errorReason: string | null;
  }>;

/**
 * Write-capability boundary for moving treasury funds.
 *
 * It is intentionally separate from the read-only TreasuryWalletPort.
 */
export interface TreasuryPaymentPort {
  submitUsdcTransfer(
    transfer: SubmitUsdcTransfer,
  ): Promise<TreasuryPaymentSubmission>;

  submitMemoUsdcTransfer(
    transfer: SubmitMemoUsdcTransfer,
  ): Promise<TreasuryPaymentSubmission>;

  waitForTransactionHash(
    transactionId: string,
    signal: AbortSignal,
  ): Promise<TreasuryPaymentStatus>;
}
