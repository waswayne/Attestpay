import { defineChain } from "viem";

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

export const ARC_TESTNET_CHAIN = defineChain({
  id: 5_042_002,
  name: "Arc Testnet",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    // Arc's native RPC representation uses 18 decimals; ERC-20 USDC uses 6.
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [...ARC_TESTNET_RPC_URLS] },
  },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
});
