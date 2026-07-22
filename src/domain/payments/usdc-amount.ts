const USDC_DECIMALS = 6;

/**
 * Converts a human-readable USDC amount into integer micro-USDC.
 *
 * Financial amounts never pass through JavaScript floating-point numbers.
 */
export function parseUsdcAmount(amount: string): bigint {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(amount);

  if (!match) {
    throw new Error("USDC amount must be a plain positive decimal with at most 6 decimals.");
  }

  const whole = match[1];
  const fraction = (match[2] ?? "").padEnd(USDC_DECIMALS, "0");

  if (whole === undefined) {
    throw new Error("USDC amount is missing its whole-number component.");
  }

  const atomicUnits = BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) + BigInt(fraction);

  if (atomicUnits <= 0n) {
    throw new Error("USDC amount must be greater than zero.");
  }

  return atomicUnits;
}

export function formatUsdcAmount(amountBaseUnits: bigint): string {
  if (amountBaseUnits <= 0n) {
    throw new Error("USDC amount must be greater than zero.");
  }
  const whole = amountBaseUnits / 1_000_000n;
  const fraction = (amountBaseUnits % 1_000_000n)
    .toString()
    .padStart(USDC_DECIMALS, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
