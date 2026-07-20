import { z } from "zod";
import { evmAddressSchema } from "../shared/validation/evm.js";

const vaultEnvironmentSchema = z.object({
  ATTESTPAY_VAULT_ADDRESS: evmAddressSchema,
});

export type AttestPayVaultConfig = Readonly<{
  address: `0x${string}`;
}>;

export function loadAttestPayVaultConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AttestPayVaultConfig {
  const result = vaultEnvironmentSchema.safeParse(environment);
  if (!result.success) {
    throw new Error("Invalid AttestPay vault configuration: ATTESTPAY_VAULT_ADDRESS");
  }

  return Object.freeze({ address: result.data.ATTESTPAY_VAULT_ADDRESS });
}
