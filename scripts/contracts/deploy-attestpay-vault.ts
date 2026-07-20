import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { initiateSmartContractPlatformClient } from "@circle-fin/smart-contract-platform";
import {
  createPublicClient,
  fallback,
  getAddress,
  http,
  isAddress,
  isHex,
  keccak256,
  stringToHex,
  type Hex,
} from "viem";
import { loadCircleTreasuryConfig } from "../../src/config/circle-treasury.config.js";
import { loadCircleVaultAuthorizerConfig } from "../../src/config/circle-vault-authorizer.config.js";
import { parseUsdcAmount } from "../../src/domain/payments/usdc-amount.js";
import { ATTESTPAY_VAULT_ABI } from "../../src/infrastructure/arc/attestpay-vault.js";
import {
  ARC_TESTNET_CHAIN,
  ARC_TESTNET_RPC_URLS,
  ARC_TESTNET_USDC_ADDRESS,
} from "../../src/infrastructure/arc/arc-testnet.constants.js";
import { circleApiErrorDetail } from "../../src/infrastructure/circle/circle-api-error.js";
import { saveLocalEnvironmentValue } from "../circle/local-environment-file.js";

type ContractArtifact = Readonly<{
  abi: readonly unknown[];
  bytecode: Hex;
}>;

function positiveInteger(name: string, fallbackValue: string): bigint {
  const value = process.env[name]?.trim() || fallbackValue;
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return BigInt(value);
}

async function loadArtifact(): Promise<ContractArtifact> {
  const url = new URL(
    "../../artifacts/contracts/AttestPayVault.sol/AttestPayVault.json",
    import.meta.url,
  );
  const parsed: unknown = JSON.parse(await readFile(url, "utf8"));
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("abi" in parsed) ||
    !Array.isArray(parsed.abi) ||
    !("bytecode" in parsed) ||
    typeof parsed.bytecode !== "string" ||
    !isHex(parsed.bytecode) ||
    parsed.bytecode === "0x"
  ) {
    throw new Error("Hardhat produced an invalid AttestPayVault artifact.");
  }
  return { abi: parsed.abi, bytecode: parsed.bytecode };
}

const treasury = loadCircleTreasuryConfig();
const authorizer = loadCircleVaultAuthorizerConfig();
if (treasury.walletAddress.toLowerCase() === authorizer.walletAddress.toLowerCase()) {
  throw new Error("The vault executor and authorizer must be different wallets.");
}

const adminDelay = positiveInteger(
  "ATTESTPAY_VAULT_ADMIN_DELAY_SECONDS",
  "86400",
);
if (adminDelay > 2n ** 48n - 1n) {
  throw new Error("ATTESTPAY_VAULT_ADMIN_DELAY_SECONDS exceeds uint48.");
}

const maxPayment = parseUsdcAmount(
  process.env.ATTESTPAY_VAULT_MAX_PAYMENT_USDC?.trim() || "100",
);
const dailyLimit = parseUsdcAmount(
  process.env.ATTESTPAY_VAULT_DAILY_LIMIT_USDC?.trim() || "500",
);
if (dailyLimit < maxPayment) {
  throw new Error("The vault daily limit must be at least the per-payment limit.");
}

const artifact = await loadArtifact();
const client = initiateSmartContractPlatformClient({
  apiKey: treasury.apiKey,
  entitySecret: treasury.entitySecret,
});

type DeployContractInput = Parameters<typeof client.deployContract>[0];

function circleDeploymentError(error: unknown, requestId: string): Error {
  return new Error(
    `Circle vault deployment request failed. Request ID: ${requestId}. ${circleApiErrorDetail(error)}`,
  );
}

let contractId = process.env.ATTESTPAY_VAULT_CONTRACT_ID?.trim();
let deploymentTransactionId =
  process.env.ATTESTPAY_VAULT_DEPLOYMENT_TRANSACTION_ID?.trim();

if (!contractId) {
  const requestVersion = "2";
  const storedRequestVersion =
    process.env.ATTESTPAY_VAULT_DEPLOYMENT_REQUEST_VERSION?.trim();
  let idempotencyKey =
    process.env.ATTESTPAY_VAULT_DEPLOYMENT_IDEMPOTENCY_KEY?.trim();

  if (!idempotencyKey || storedRequestVersion !== requestVersion) {
    idempotencyKey = randomUUID();
    await saveLocalEnvironmentValue(
      "ATTESTPAY_VAULT_DEPLOYMENT_IDEMPOTENCY_KEY",
      idempotencyKey,
    );
    await saveLocalEnvironmentValue(
      "ATTESTPAY_VAULT_DEPLOYMENT_REQUEST_VERSION",
      requestVersion,
    );
  }

  const deploymentRequest = {
    name: "AttestPayVault",
    blockchain: "ARC-TESTNET",
    walletId: treasury.walletId,
    abiJson: JSON.stringify(artifact.abi),
    bytecode: artifact.bytecode,
    constructorParameters: [
      ARC_TESTNET_USDC_ADDRESS,
      treasury.walletAddress,
      treasury.walletAddress,
      authorizer.walletAddress,
      adminDelay.toString(),
      maxPayment.toString(),
      dailyLimit.toString(),
    ],
    idempotencyKey,
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  } satisfies DeployContractInput;
  const requestId = randomUUID();
  let response;
  try {
    await client.estimateContractDeploymentFee({
      walletId: treasury.walletId,
      abiJson: deploymentRequest.abiJson,
      bytecode: deploymentRequest.bytecode,
      constructorParameters: deploymentRequest.constructorParameters ?? [],
    });
    response = await client.deployContract({
      ...deploymentRequest,
      xRequestId: requestId,
    });
  } catch (error: unknown) {
    throw circleDeploymentError(error, requestId);
  }

  contractId = response.data?.contractId;
  deploymentTransactionId = response.data?.transactionId;
  if (!contractId || !deploymentTransactionId) {
    throw new Error("Circle returned an invalid vault deployment response.");
  }

  await saveLocalEnvironmentValue("ATTESTPAY_VAULT_CONTRACT_ID", contractId);
  await saveLocalEnvironmentValue(
    "ATTESTPAY_VAULT_DEPLOYMENT_TRANSACTION_ID",
    deploymentTransactionId,
  );
  console.log(`Vault deployment submitted: ${deploymentTransactionId}`);
}

const deadline = Date.now() + 180_000;
let deployedContract;
while (Date.now() < deadline) {
  const response = await client.getContract({ id: contractId });
  const contract = response.data?.contract;
  if (!contract || contract.id !== contractId) {
    throw new Error("Circle returned an invalid vault contract record.");
  }
  if (contract.status === "FAILED") {
    throw new Error(
      `Vault deployment failed: ${contract.deploymentErrorReason ?? "unknown reason"}`,
    );
  }
  if (contract.status === "COMPLETE") {
    deployedContract = contract;
    break;
  }
  await delay(2_000);
}

if (
  !deployedContract ||
  deployedContract.blockchain !== "ARC-TESTNET" ||
  !deployedContract.contractAddress ||
  !isAddress(deployedContract.contractAddress, { strict: false })
) {
  throw new Error("Vault deployment did not reach a verifiable COMPLETE state.");
}

const vaultAddress = getAddress(deployedContract.contractAddress.toLowerCase());
const publicClient = createPublicClient({
  chain: ARC_TESTNET_CHAIN,
  transport: fallback(
    ARC_TESTNET_RPC_URLS.map((url) =>
      http(url, { retryCount: 1, timeout: 10_000 }),
    ),
  ),
});
const code = await publicClient.getCode({ address: vaultAddress });
if (!code || code === "0x") {
  throw new Error("Arc returned no deployed bytecode for AttestPayVault.");
}

const executorRole = keccak256(stringToHex("EXECUTOR_ROLE"));
const authorizerRole = keccak256(stringToHex("AUTHORIZER_ROLE"));
const [asset, admin, executorGranted, authorizerGranted, onchainMax, onchainDaily] =
  await Promise.all([
    publicClient.readContract({
      address: vaultAddress,
      abi: ATTESTPAY_VAULT_ABI,
      functionName: "usdc",
    }),
    publicClient.readContract({
      address: vaultAddress,
      abi: ATTESTPAY_VAULT_ABI,
      functionName: "defaultAdmin",
    }),
    publicClient.readContract({
      address: vaultAddress,
      abi: ATTESTPAY_VAULT_ABI,
      functionName: "hasRole",
      args: [executorRole, treasury.walletAddress],
    }),
    publicClient.readContract({
      address: vaultAddress,
      abi: ATTESTPAY_VAULT_ABI,
      functionName: "hasRole",
      args: [authorizerRole, authorizer.walletAddress],
    }),
    publicClient.readContract({
      address: vaultAddress,
      abi: ATTESTPAY_VAULT_ABI,
      functionName: "maxPaymentAmount",
    }),
    publicClient.readContract({
      address: vaultAddress,
      abi: ATTESTPAY_VAULT_ABI,
      functionName: "dailyLimit",
    }),
  ]);

if (
  asset.toLowerCase() !== ARC_TESTNET_USDC_ADDRESS.toLowerCase() ||
  admin.toLowerCase() !== treasury.walletAddress.toLowerCase() ||
  !executorGranted ||
  !authorizerGranted ||
  onchainMax !== maxPayment ||
  onchainDaily !== dailyLimit
) {
  throw new Error("The deployed vault does not match its required authority and policy.");
}

await saveLocalEnvironmentValue("ATTESTPAY_VAULT_ADDRESS", vaultAddress);
if (deployedContract.txHash && isHex(deployedContract.txHash)) {
  await saveLocalEnvironmentValue(
    "ATTESTPAY_VAULT_DEPLOYMENT_TX_HASH",
    deployedContract.txHash,
  );
}

console.log("AttestPayVault is deployed and independently verified:");
console.log(`  Address: ${vaultAddress}`);
console.log(`  Circle contract ID: ${contractId}`);
console.log(`  Executor: ${treasury.walletAddress}`);
console.log(`  Authorizer: ${authorizer.walletAddress}`);
console.log(`  Bytecode: ${Math.max(0, (code.length - 2) / 2)} bytes`);
console.log("  Network: ARC-TESTNET");
