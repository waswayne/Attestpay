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

export interface SettlementVerifierPort {
  verifyUsdcSettlement(
    expected: VerifyUsdcSettlement,
  ): Promise<UsdcSettlementEvidence>;

  verifyMemoUsdcSettlement(
    expected: VerifyMemoUsdcSettlement,
  ): Promise<MemoUsdcSettlementEvidence>;
}
