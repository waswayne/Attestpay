import type { CanonicalAuthorizationReceipt } from "../domain/payments/canonical-authorization-receipt.js";
import type { CanonicalEvmAddress } from "../domain/shared/canonical-evm-address.js";
import { canonicalEvmAddressesEqual } from "../shared/validation/evm.js";

export type TrustedPaymentDeploymentContext = Readonly<{
  chainId: bigint;
  vaultAddress: CanonicalEvmAddress;
  usdcTokenAddress: CanonicalEvmAddress;
}>;

export type TrustedDeploymentContextField =
  | "chain"
  | "vault"
  | "USDC token";

export class TrustedDeploymentContextMismatchError extends Error {
  constructor(readonly field: TrustedDeploymentContextField) {
    super(`Trusted deployment ${field} mismatch.`);
    this.name = "TrustedDeploymentContextMismatchError";
  }
}

type DeploymentContextCarrier = Pick<
  CanonicalAuthorizationReceipt,
  "chainId" | "vaultAddress" | "usdcTokenAddress"
>;

/**
 * Compares stored or submitted payment data with server-owned deployment truth.
 * This helper belongs to the application boundary so pure domain records remain
 * independent of Arc constants and EVM parsing libraries.
 */
export function assertTrustedPaymentDeploymentContext(
  value: DeploymentContextCarrier,
  trusted: TrustedPaymentDeploymentContext,
): void {
  if (value.chainId !== trusted.chainId) {
    throw new TrustedDeploymentContextMismatchError("chain");
  }
  if (!canonicalEvmAddressesEqual(value.vaultAddress, trusted.vaultAddress)) {
    throw new TrustedDeploymentContextMismatchError("vault");
  }
  if (
    !canonicalEvmAddressesEqual(
      value.usdcTokenAddress,
      trusted.usdcTokenAddress,
    )
  ) {
    throw new TrustedDeploymentContextMismatchError("USDC token");
  }
}
