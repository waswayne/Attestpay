import {
  createPublicClient,
  erc20Abi,
  fallback,
  http,
  type Address,
} from "viem";
import type {
  VaultPaymentReadiness,
  VaultReaderPort,
  VaultStatus,
} from "../../application/ports/vault-reader.port.js";
import type { VaultPaymentAuthorization } from "../../domain/payments/vault-payment-authorization.js";
import {
  ARC_TESTNET_CHAIN,
  ARC_TESTNET_RPC_URLS,
  ARC_TESTNET_USDC_ADDRESS,
} from "./arc-testnet.constants.js";
import { ATTESTPAY_VAULT_ABI } from "./attestpay-vault.js";

type ArcPublicClient = Pick<
  ReturnType<typeof createPublicClient>,
  "getBytecode" | "readContract"
>;

export class ArcVaultReaderAdapter implements VaultReaderPort {
  private readonly client: ArcPublicClient;

  constructor(client?: ArcPublicClient) {
    this.client =
      client ??
      createPublicClient({
        chain: ARC_TESTNET_CHAIN,
        transport: fallback(
          ARC_TESTNET_RPC_URLS.map((url) =>
            http(url, { retryCount: 1, timeout: 10_000 }),
          ),
        ),
      });
  }

  async isRecipientApproved(
    vaultAddress: Address,
    recipientAddress: Address,
  ): Promise<boolean> {
    await this.assertVaultExists(vaultAddress);
    return this.client.readContract({
      address: vaultAddress,
      abi: ATTESTPAY_VAULT_ABI,
      functionName: "approvedRecipients",
      args: [recipientAddress],
    });
  }

  async getStatus(
    vaultAddress: Address,
    recipientAddress: Address,
  ): Promise<VaultStatus> {
    await this.assertVaultExists(vaultAddress);
    const unixDay = BigInt(Math.floor(Date.now() / 86_400_000));
    const [
      usdc,
      recipientApproved,
      paused,
      vaultBalance,
      maxPaymentAmount,
      dailyLimit,
      spentToday,
    ] = await Promise.all([
      this.client.readContract({
        address: vaultAddress,
        abi: ATTESTPAY_VAULT_ABI,
        functionName: "usdc",
      }),
      this.client.readContract({
        address: vaultAddress,
        abi: ATTESTPAY_VAULT_ABI,
        functionName: "approvedRecipients",
        args: [recipientAddress],
      }),
      this.client.readContract({
        address: vaultAddress,
        abi: ATTESTPAY_VAULT_ABI,
        functionName: "paused",
      }),
      this.client.readContract({
        address: ARC_TESTNET_USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [vaultAddress],
      }),
      this.client.readContract({
        address: vaultAddress,
        abi: ATTESTPAY_VAULT_ABI,
        functionName: "maxPaymentAmount",
      }),
      this.client.readContract({
        address: vaultAddress,
        abi: ATTESTPAY_VAULT_ABI,
        functionName: "dailyLimit",
      }),
      this.client.readContract({
        address: vaultAddress,
        abi: ATTESTPAY_VAULT_ABI,
        functionName: "spentByDay",
        args: [unixDay],
      }),
    ]);

    if (usdc.toLowerCase() !== ARC_TESTNET_USDC_ADDRESS.toLowerCase()) {
      throw new Error("The configured vault does not use canonical Arc USDC.");
    }

    return Object.freeze({
      recipientApproved,
      paused,
      vaultBalance,
      maxPaymentAmount,
      dailyLimit,
      spentToday,
    });
  }

  async getPaymentReadiness(
    vaultAddress: Address,
    authorization: VaultPaymentAuthorization,
  ): Promise<VaultPaymentReadiness> {
    const [status, paymentAlreadyUsed] = await Promise.all([
      this.getStatus(vaultAddress, authorization.recipient),
      this.client.readContract({
        address: vaultAddress,
        abi: ATTESTPAY_VAULT_ABI,
        functionName: "usedPaymentIds",
        args: [authorization.paymentId],
      }),
    ]);

    return Object.freeze({
      ...status,
      paymentAlreadyUsed,
    });
  }

  private async assertVaultExists(vaultAddress: Address): Promise<void> {
    const code = await this.client.getBytecode({ address: vaultAddress });
    if (!code || code === "0x") {
      throw new Error("The configured vault has no deployed Arc bytecode.");
    }
  }
}
