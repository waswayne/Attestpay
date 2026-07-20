import { randomUUID } from "node:crypto";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { z } from "zod";
import type {
  TreasuryAssetBalance,
  TreasuryWalletDetails,
  TreasuryWalletPort,
} from "../../application/ports/treasury-wallet.port.js";
import type { CircleTreasuryConfig } from "../../config/circle-treasury.config.js";
import { evmAddressSchema } from "../../shared/validation/evm.js";
import { ARC_TESTNET_USDC_ADDRESS } from "../arc/arc-testnet.constants.js";

type DeveloperWalletsClient = ReturnType<
  typeof initiateDeveloperControlledWalletsClient
>;

export type CircleTreasuryWalletClient = Pick<
  DeveloperWalletsClient,
  "getWallet" | "getWalletTokenBalance"
>;

const walletSchema = z.object({
  id: z.string().uuid(),
  address: evmAddressSchema,
  blockchain: z.literal("ARC-TESTNET"),
  accountType: z.literal("EOA"),
  state: z.enum(["LIVE", "FROZEN"]),
});

const balanceSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d+)?$/, "must be a decimal string"),
  token: z.object({
    id: z.string().uuid(),
    blockchain: z.literal("ARC-TESTNET"),
    isNative: z.boolean(),
    symbol: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    decimals: z.number().int().nonnegative().optional(),
    tokenAddress: evmAddressSchema.optional(),
  }),
});

const balancesSchema = z.array(balanceSchema);

export class CircleTreasuryAdapterError extends Error {
  readonly requestId: string;

  constructor(operation: string, requestId: string, options?: ErrorOptions) {
    super(`Circle treasury ${operation} failed. Request ID: ${requestId}`, options);
    this.name = "CircleTreasuryAdapterError";
    this.requestId = requestId;
  }
}

export class CircleTreasuryWalletAdapter implements TreasuryWalletPort {
  private readonly client: CircleTreasuryWalletClient;

  constructor(
    private readonly config: CircleTreasuryConfig,
    client?: CircleTreasuryWalletClient,
  ) {
    this.client =
      client ??
      initiateDeveloperControlledWalletsClient({
        apiKey: config.apiKey,
        entitySecret: config.entitySecret,
      });
  }

  async getDetails(): Promise<TreasuryWalletDetails> {
    const requestId = randomUUID();

    try {
      const response = await this.client.getWallet({
        id: this.config.walletId,
        xRequestId: requestId,
      });
      const parsed = walletSchema.safeParse(response.data?.wallet);

      if (!parsed.success) {
        throw new Error("Circle returned an invalid wallet response.");
      }

      if (
        parsed.data.id !== this.config.walletId ||
        parsed.data.address.toLowerCase() !== this.config.walletAddress.toLowerCase()
      ) {
        throw new Error("Circle returned a different wallet than configured.");
      }

      return Object.freeze({
        id: parsed.data.id,
        address: parsed.data.address,
        network: parsed.data.blockchain,
        accountType: parsed.data.accountType,
        state: parsed.data.state,
      });
    } catch (error: unknown) {
      throw new CircleTreasuryAdapterError("wallet lookup", requestId, {
        cause: error,
      });
    }
  }

  async listBalances(): Promise<readonly TreasuryAssetBalance[]> {
    const requestId = randomUUID();

    try {
      const response = await this.client.getWalletTokenBalance({
        id: this.config.walletId,
        includeAll: true,
        pageSize: 50,
        xRequestId: requestId,
      });

      if (!response.data) {
        throw new Error("Circle returned no balance response data.");
      }

      const parsed = balancesSchema.safeParse(response.data.tokenBalances ?? []);
      if (!parsed.success) {
        throw new Error("Circle returned an invalid token-balance response.");
      }

      const mappedBalances: TreasuryAssetBalance[] = parsed.data.map((balance) =>
        Object.freeze({
          tokenId: balance.token.id,
          amount: balance.amount,
          symbol: balance.token.symbol ?? null,
          name: balance.token.name ?? null,
          decimals: balance.token.decimals ?? null,
          isNative: balance.token.isNative,
          tokenAddress: balance.token.tokenAddress ?? null,
        }),
      );

      const hasErc20Usdc = mappedBalances.some(
        (balance) =>
          balance.tokenAddress?.toLowerCase() ===
          ARC_TESTNET_USDC_ADDRESS.toLowerCase(),
      );

      // Arc native USDC and its ERC-20 interface share one underlying balance.
      // When Circle returns both views, keep only the ERC-20 accounting view.
      const canonicalBalances = hasErc20Usdc
        ? mappedBalances.filter(
            (balance) =>
              !(balance.isNative && balance.symbol?.toUpperCase() === "USDC"),
          )
        : mappedBalances;

      return Object.freeze(canonicalBalances);
    } catch (error: unknown) {
      throw new CircleTreasuryAdapterError("balance lookup", requestId, {
        cause: error,
      });
    }
  }
}
