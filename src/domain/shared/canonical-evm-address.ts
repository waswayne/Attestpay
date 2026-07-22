declare const canonicalEvmAddressBrand: unique symbol;

/**
 * An EVM address that has already been validated and normalized at a system
 * boundary. Domain code can compare and hash this value without importing a
 * blockchain library.
 */
export type CanonicalEvmAddress = `0x${string}` & {
  readonly [canonicalEvmAddressBrand]: true;
};
