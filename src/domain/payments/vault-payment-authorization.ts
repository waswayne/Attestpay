export type VaultPaymentAuthorization = Readonly<{
  paymentId: `0x${string}`;
  recipient: `0x${string}`;
  amount: bigint;
  invoiceHash: `0x${string}`;
  policyHash: `0x${string}`;
  validAfter: number;
  deadline: number;
  authorizer: `0x${string}`;
}>;
