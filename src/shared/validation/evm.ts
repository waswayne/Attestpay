import { getAddress, isAddress, isHash, type Address, type Hash } from "viem";
import { z } from "zod";

export const evmAddressSchema = z
  .string()
  .refine((value) => isAddress(value, { strict: false }), {
    message: "must be a valid EVM address",
  })
  .transform((value): Address => getAddress(value.toLowerCase()));

export const transactionHashSchema = z
  .string()
  .refine(isHash, { message: "must be a 32-byte transaction hash" })
  .transform((value) => value as Hash);
