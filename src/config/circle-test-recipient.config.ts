import { z } from "zod";
import { evmAddressSchema } from "../shared/validation/evm.js";

const recipientEnvironmentSchema = z.object({
  CIRCLE_TEST_RECIPIENT_WALLET_ID: z.string().uuid(),
  CIRCLE_TEST_RECIPIENT_ADDRESS: evmAddressSchema,
});

export type CircleTestRecipientConfig = Readonly<{
  walletId: string;
  address: `0x${string}`;
}>;

export function loadCircleTestRecipientConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CircleTestRecipientConfig {
  const result = recipientEnvironmentSchema.safeParse(environment);

  if (!result.success) {
    const invalidFields = [
      ...new Set(result.error.issues.map((issue) => issue.path.join("."))),
    ];
    throw new Error(
      `Invalid Circle test-recipient configuration: ${invalidFields.join(", ")}`,
    );
  }

  return Object.freeze({
    walletId: result.data.CIRCLE_TEST_RECIPIENT_WALLET_ID,
    address: result.data.CIRCLE_TEST_RECIPIENT_ADDRESS,
  });
}
