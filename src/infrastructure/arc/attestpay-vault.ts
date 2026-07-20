import {
  encodeFunctionData,
  parseAbi,
  serializeTypedData,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import type { VaultPaymentAuthorization } from "../../domain/payments/vault-payment-authorization.js";
import { ARC_TESTNET_CHAIN } from "./arc-testnet.constants.js";
import { prepareArcMemoCall } from "./arc-memo.js";

export const ATTESTPAY_VAULT_EIP712_NAME = "AttestPayVault";
export const ATTESTPAY_VAULT_EIP712_VERSION = "1";

export const ATTESTPAY_VAULT_ABI = parseAbi([
  "function executePayment((bytes32 paymentId,address recipient,uint256 amount,bytes32 invoiceHash,bytes32 policyHash,uint48 validAfter,uint48 deadline,address authorizer) authorization, bytes signature)",
  "function hashAuthorization((bytes32 paymentId,address recipient,uint256 amount,bytes32 invoiceHash,bytes32 policyHash,uint48 validAfter,uint48 deadline,address authorizer) authorization) view returns (bytes32)",
  "function usdc() view returns (address)",
  "function maxPaymentAmount() view returns (uint256)",
  "function dailyLimit() view returns (uint256)",
  "function defaultAdmin() view returns (address)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
  "function approvedRecipients(address recipient) view returns (bool)",
  "event PaymentExecuted(bytes32 indexed paymentId,address indexed recipient,address indexed authorizer,uint256 amount,bytes32 invoiceHash,bytes32 policyHash,address executor,uint256 unixDay,uint256 spentToday)",
]);

export const VAULT_PAYMENT_AUTHORIZATION_TYPES = {
  PaymentAuthorization: [
    { name: "paymentId", type: "bytes32" },
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "invoiceHash", type: "bytes32" },
    { name: "policyHash", type: "bytes32" },
    { name: "validAfter", type: "uint48" },
    { name: "deadline", type: "uint48" },
    { name: "authorizer", type: "address" },
  ],
} as const;

export function getVaultPaymentTypedData(
  vaultAddress: Address,
  authorization: VaultPaymentAuthorization,
) {
  return {
    domain: {
      name: ATTESTPAY_VAULT_EIP712_NAME,
      version: ATTESTPAY_VAULT_EIP712_VERSION,
      chainId: ARC_TESTNET_CHAIN.id,
      verifyingContract: vaultAddress,
    },
    types: VAULT_PAYMENT_AUTHORIZATION_TYPES,
    primaryType: "PaymentAuthorization" as const,
    message: authorization,
  } as const;
}

export function serializeVaultPaymentTypedData(
  vaultAddress: Address,
  authorization: VaultPaymentAuthorization,
): string {
  return serializeTypedData(getVaultPaymentTypedData(vaultAddress, authorization));
}

export type PreparedArcVaultPayment = Readonly<{
  contractCallData: Hex;
  vaultCallData: Hex;
  vaultCallDataHash: Hash;
  memoId: Hash;
  memoData: Hex;
}>;

export function prepareArcVaultPayment(input: {
  vaultAddress: Address;
  authorization: VaultPaymentAuthorization;
  signature: Hex;
  authorizationReference: string;
}): PreparedArcVaultPayment {
  const vaultCallData = encodeFunctionData({
    abi: ATTESTPAY_VAULT_ABI,
    functionName: "executePayment",
    args: [input.authorization, input.signature],
  });
  const memo = prepareArcMemoCall({
    targetAddress: input.vaultAddress,
    targetCallData: vaultCallData,
    authorizationReference: input.authorizationReference,
  });

  return Object.freeze({
    contractCallData: memo.contractCallData,
    vaultCallData,
    vaultCallDataHash: memo.targetCallDataHash,
    memoId: memo.memoId,
    memoData: memo.memoData,
  });
}
