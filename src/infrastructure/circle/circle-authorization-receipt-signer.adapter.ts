import { randomUUID } from "node:crypto";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { bytesToHex, isHex, size, type Hex } from "viem";
import type { AuthorizationReceiptSignerPort } from "../../application/ports/authorization-receipt-signer.port.js";
import type { CircleVaultAuthorizerConfig } from "../../config/circle-vault-authorizer.config.js";
import {
  serializeAuthorizationReceiptTypedData,
  verifyCanonicalAuthorizationReceipt,
} from "../arc/authorization-receipt-signature.js";
import { InMemoryAuthorizationReplayProtection } from "../local/in-memory-authorization-replay-protection.js";
import { sanitizedCircleApiCause } from "./circle-api-error.js";

type Client = ReturnType<typeof initiateDeveloperControlledWalletsClient>;
type SignInput = Parameters<Client["signTypedData"]>[0];

export type CircleReceiptSigningClient = Readonly<{
  signTypedData(input: SignInput): Promise<{ data?: { signature?: string } }>;
}>;

export class CircleAuthorizationReceiptSignerAdapter
  implements AuthorizationReceiptSignerPort
{
  private readonly client: CircleReceiptSigningClient;

  constructor(
    private readonly config: CircleVaultAuthorizerConfig,
    client?: CircleReceiptSigningClient,
  ) {
    this.client = client ?? initiateDeveloperControlledWalletsClient({
      apiKey: config.apiKey,
      entitySecret: config.entitySecret,
    });
  }

  async signAuthorizationReceipt(input: {
    receipt: Parameters<AuthorizationReceiptSignerPort["signAuthorizationReceipt"]>[0]["receipt"];
    explanation: string;
  }): Promise<Hex> {
    const requestId = randomUUID();
    if (
      input.receipt.authorizer.toLowerCase() !==
      this.config.walletAddress.toLowerCase()
    ) {
      throw new Error("Authorization receipt is assigned to a different signer.");
    }
    try {
      const response = await this.client.signTypedData({
        walletId: this.config.walletId,
        data: serializeAuthorizationReceiptTypedData(input.receipt),
        memo: input.explanation,
        xRequestId: requestId,
      });
      const signature = normalizeSignature(response.data?.signature);
      const verification = await verifyCanonicalAuthorizationReceipt({
        receipt: input.receipt,
        signature,
        expected: {
          decisionHash: input.receipt.decisionHash,
          policyDefinitionHash: input.receipt.policyDefinitionHash,
          policyInputHash: input.receipt.policyInputHash,
          authorizationOutcome: input.receipt.authorizationOutcome,
          expectedAuthorizer: input.receipt.authorizer,
          chainId: input.receipt.chainId,
          vaultAddress: input.receipt.vaultAddress,
          recipientAddress: input.receipt.recipientAddress,
          usdcTokenAddress: input.receipt.usdcTokenAddress,
          amountBaseUnits: input.receipt.amountBaseUnits,
          paymentReference: input.receipt.paymentReference,
          nonce: input.receipt.nonce,
        },
        verifiedAt: input.receipt.issuedAt,
        replayProtection: new InMemoryAuthorizationReplayProtection(),
      });
      if (!verification.valid) {
        throw new Error("Circle returned an invalid authorization-receipt signature.");
      }
      return signature;
    } catch (error: unknown) {
      throw new Error(`Circle receipt signing failed. Request ID: ${requestId}`, {
        cause: sanitizedCircleApiCause(error),
      });
    }
  }
}

function normalizeSignature(value: string | undefined): Hex {
  if (!value) throw new Error("Circle returned no receipt signature.");
  if (isHex(value) && size(value) === 65) return value;
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength !== 65) throw new Error("Circle returned a malformed signature.");
  return bytesToHex(decoded);
}
