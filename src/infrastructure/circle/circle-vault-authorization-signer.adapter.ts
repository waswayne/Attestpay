import { randomUUID } from "node:crypto";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import {
  bytesToHex,
  isHex,
  size,
  verifyTypedData,
  type Hex,
} from "viem";
import type {
  PaymentAuthorizationSignerPort,
  SignVaultPaymentAuthorization,
} from "../../application/ports/payment-authorization-signer.port.js";
import type { CircleVaultAuthorizerConfig } from "../../config/circle-vault-authorizer.config.js";
import {
  getVaultPaymentTypedData,
  serializeVaultPaymentTypedData,
} from "../arc/attestpay-vault.js";
import { sanitizedCircleApiCause } from "./circle-api-error.js";

type DeveloperWalletsClient = ReturnType<
  typeof initiateDeveloperControlledWalletsClient
>;

type SignTypedDataInput = Parameters<DeveloperWalletsClient["signTypedData"]>[0];

export type CircleSigningClient = Readonly<{
  signTypedData(input: SignTypedDataInput): Promise<{
    data?: { signature?: string };
  }>;
}>;

export class CircleVaultAuthorizationSigningError extends Error {
  constructor(readonly requestId: string, options?: ErrorOptions) {
    super(`Circle vault authorization signing failed. Request ID: ${requestId}`, options);
    this.name = "CircleVaultAuthorizationSigningError";
  }
}

export class CircleVaultAuthorizationSignerAdapter
  implements PaymentAuthorizationSignerPort
{
  private readonly client: CircleSigningClient;

  constructor(
    private readonly config: CircleVaultAuthorizerConfig,
    client?: CircleSigningClient,
  ) {
    this.client =
      client ??
      initiateDeveloperControlledWalletsClient({
        apiKey: config.apiKey,
        entitySecret: config.entitySecret,
      });
  }

  async signVaultPaymentAuthorization(
    input: SignVaultPaymentAuthorization,
  ): Promise<Hex> {
    const requestId = randomUUID();

    if (
      input.authorization.authorizer.toLowerCase() !==
      this.config.walletAddress.toLowerCase()
    ) {
      throw new CircleVaultAuthorizationSigningError(requestId, {
        cause: new Error("Authorization is assigned to a different signer."),
      });
    }

    try {
      const response = await this.client.signTypedData({
        walletId: this.config.walletId,
        data: serializeVaultPaymentTypedData(
          input.vaultAddress,
          input.authorization,
        ),
        memo: input.explanation,
        xRequestId: requestId,
      });
      const signature = normalizeEvmSignature(response.data?.signature);
      const valid = await verifyTypedData({
        address: this.config.walletAddress,
        ...getVaultPaymentTypedData(input.vaultAddress, input.authorization),
        signature,
      });

      if (!valid) {
        throw new Error("Circle returned a signature from an unexpected key.");
      }

      return signature;
    } catch (error: unknown) {
      if (error instanceof CircleVaultAuthorizationSigningError) throw error;
      throw new CircleVaultAuthorizationSigningError(requestId, {
        cause: sanitizedCircleApiCause(error),
      });
    }
  }
}

function normalizeEvmSignature(value: string | undefined): Hex {
  if (!value) throw new Error("Circle returned no authorization signature.");

  if (isHex(value) && size(value) === 65) return value;

  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength !== 65) {
    throw new Error("Circle returned an invalid EVM authorization signature.");
  }

  return bytesToHex(decoded);
}
