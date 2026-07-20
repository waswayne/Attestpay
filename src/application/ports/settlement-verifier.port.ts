export type VerifyUsdcSettlement = Readonly<{
  transactionHash: `0x${string}`;
  senderAddress: `0x${string}`;
  recipientAddress: `0x${string}`;
  amount: string;
}>;

export type UsdcSettlementEvidence = Readonly<{
  transactionHash: `0x${string}`;
  blockNumber: string;
  logIndex: number;
  senderAddress: `0x${string}`;
  recipientAddress: `0x${string}`;
  amount: string;
}>;

export type VerifyMemoUsdcSettlement = VerifyUsdcSettlement &
  Readonly<{
    memoId: `0x${string}`;
    memoData: `0x${string}`;
    transferCallDataHash: `0x${string}`;
  }>;

export type MemoUsdcSettlementEvidence = UsdcSettlementEvidence &
  Readonly<{
    memoId: `0x${string}`;
    memoIndex: string;
    memoLogIndex: number;
  }>;

export type VerifyVaultRecipientApproval = Readonly<{
  transactionHash: `0x${string}`;
  vaultAddress: `0x${string}`;
  administratorAddress: `0x${string}`;
  recipientAddress: `0x${string}`;
  approved: boolean;
  memoId: `0x${string}`;
  memoData: `0x${string}`;
  vaultCallDataHash: `0x${string}`;
}>;

export type VaultRecipientApprovalEvidence = Readonly<{
  transactionHash: `0x${string}`;
  blockNumber: string;
  approvalLogIndex: number;
  memoIndex: string;
  memoLogIndex: number;
}>;

export type VerifyVaultPaymentSettlement = Omit<
  VerifyMemoUsdcSettlement,
  "senderAddress"
> &
  Readonly<{
    vaultAddress: `0x${string}`;
    executorAddress: `0x${string}`;
    authorizerAddress: `0x${string}`;
    paymentId: `0x${string}`;
    invoiceHash: `0x${string}`;
    policyHash: `0x${string}`;
  }>;

export type VaultPaymentSettlementEvidence = MemoUsdcSettlementEvidence &
  Readonly<{
    paymentEventLogIndex: number;
    paymentId: `0x${string}`;
  }>;

export interface SettlementVerifierPort {
  verifyUsdcSettlement(
    expected: VerifyUsdcSettlement,
  ): Promise<UsdcSettlementEvidence>;

  verifyMemoUsdcSettlement(
    expected: VerifyMemoUsdcSettlement,
  ): Promise<MemoUsdcSettlementEvidence>;

  verifyVaultRecipientApproval(
    expected: VerifyVaultRecipientApproval,
  ): Promise<VaultRecipientApprovalEvidence>;

  verifyVaultPaymentSettlement(
    expected: VerifyVaultPaymentSettlement,
  ): Promise<VaultPaymentSettlementEvidence>;
}
