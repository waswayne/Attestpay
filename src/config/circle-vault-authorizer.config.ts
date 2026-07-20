import { isHex, size } from "viem";
import { z } from "zod";
import { evmAddressSchema } from "../shared/validation/evm.js";

const authorizerEnvironmentSchema = z.object({
  CIRCLE_API_KEY: z.string().startsWith("TEST_API_KEY:"),
  CIRCLE_ENTITY_SECRET: z
    .string()
    .refine((value) => isHex(`0x${value}`) && size(`0x${value}`) === 32),
  CIRCLE_VAULT_AUTHORIZER_WALLET_ID: z.string().uuid(),
  CIRCLE_VAULT_AUTHORIZER_ADDRESS: evmAddressSchema,
});

export type CircleVaultAuthorizerConfig = Readonly<{
  apiKey: string;
  entitySecret: string;
  walletId: string;
  walletAddress: `0x${string}`;
}>;

export function loadCircleVaultAuthorizerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CircleVaultAuthorizerConfig {
  const result = authorizerEnvironmentSchema.safeParse(environment);
  if (!result.success) {
    const invalidFields = [
      ...new Set(result.error.issues.map((issue) => issue.path.join("."))),
    ];
    throw new Error(
      `Invalid Circle vault-authorizer configuration: ${invalidFields.join(", ")}`,
    );
  }

  return Object.freeze({
    apiKey: result.data.CIRCLE_API_KEY,
    entitySecret: result.data.CIRCLE_ENTITY_SECRET,
    walletId: result.data.CIRCLE_VAULT_AUTHORIZER_WALLET_ID,
    walletAddress: result.data.CIRCLE_VAULT_AUTHORIZER_ADDRESS,
  });
}
