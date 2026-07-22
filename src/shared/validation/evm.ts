import {
  getAddress,
  isAddress,
  isHash,
  zeroAddress,
  type Address,
  type Hash,
} from "viem";
import { z } from "zod";
import type { CanonicalEvmAddress } from "../../domain/shared/canonical-evm-address.js";

export const evmAddressSchema = z
  .string()
  .refine((value) => isAddress(value, { strict: false }), {
    message: "must be a valid EVM address",
  })
  .transform((value): Address => getAddress(value.toLowerCase()));

export const canonicalEvmAddressSchema = evmAddressSchema
  .refine((value) => value !== zeroAddress, {
    message: "must not be the zero address",
  })
  .transform((value) => value as CanonicalEvmAddress);

export function parseCanonicalEvmAddress(value: string): CanonicalEvmAddress {
  return canonicalEvmAddressSchema.parse(value);
}

export function canonicalEvmAddressesEqual(
  first: string,
  second: string,
): boolean {
  return parseCanonicalEvmAddress(first) === parseCanonicalEvmAddress(second);
}

export const transactionHashSchema = z
  .string()
  .refine(isHash, { message: "must be a 32-byte transaction hash" })
  .transform((value) => value as Hash);
