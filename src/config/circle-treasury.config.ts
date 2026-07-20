import { isHex, size } from "viem";
import { z } from "zod";
import { evmAddressSchema } from "../shared/validation/evm.js";

const circleEnvironmentSchema = z.object({
  CIRCLE_API_KEY: z
    .string()
    .startsWith("TEST_API_KEY:", "must be a Circle Testnet API key"),
  CIRCLE_ENTITY_SECRET: z
    .string()
    .refine(
      (value) => isHex(`0x${value}`) && size(`0x${value}`) === 32,
      "must be a 32-byte hexadecimal key",
    ),
  CIRCLE_WALLET_ID: z.string().uuid("must be a UUID"),
  CIRCLE_WALLET_ADDRESS: evmAddressSchema,
});

export type CircleTreasuryConfig = Readonly<{
  apiKey: string;
  entitySecret: string;
  walletId: string;
  walletAddress: `0x${string}`;
}>;

export function loadCircleTreasuryConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CircleTreasuryConfig {
  const result = circleEnvironmentSchema.safeParse(environment);

  if (!result.success) {
    // Configuration errors name fields without echoing credentials.
    const invalidFields = [
      ...new Set(
        result.error.issues.map((issue) => issue.path.join(".") || "environment"),
      ),
    ];

    throw new Error(
      `Invalid Circle treasury configuration: ${invalidFields.join(", ")}`,
    );
  }

  return Object.freeze({
    apiKey: result.data.CIRCLE_API_KEY,
    entitySecret: result.data.CIRCLE_ENTITY_SECRET,
    walletId: result.data.CIRCLE_WALLET_ID,
    walletAddress: result.data.CIRCLE_WALLET_ADDRESS,
  });
}
