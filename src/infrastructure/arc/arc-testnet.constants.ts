import { arcTestnet } from "viem/chains";

/**
 * Arc exposes its native USDC balance through this ERC-20 interface.
 * Application-level transfers and accounting use the 6-decimal ERC-20 view.
 */
export const ARC_TESTNET_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000" as const;

export const ARC_TESTNET_RPC_URLS = [
  "https://rpc.testnet.arc.network",
  "https://rpc.drpc.testnet.arc.network",
  "https://rpc.blockdaemon.testnet.arc.network",
  "https://rpc.quicknode.testnet.arc.network",
] as const;

export const ARC_TESTNET_CHAIN = arcTestnet;
