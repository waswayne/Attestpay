import { resolve } from "node:path";
import { executeAuthorizedPayment } from "../../application/use-cases/execute-authorized-payment.js";
import type { TrustedPaymentDeploymentContext } from "../../application/trusted-payment-deployment-context.js";
import { loadAttestPayOperatorConfig } from "../../config/attestpay-operator.config.js";
import { loadAttestPayVaultConfig } from "../../config/attestpay-vault.config.js";
import { loadCircleTreasuryConfig } from "../../config/circle-treasury.config.js";
import { loadCircleVaultAuthorizerConfig } from "../../config/circle-vault-authorizer.config.js";
import { ArcSettlementVerifierAdapter } from "../../infrastructure/arc/arc-settlement-verifier.adapter.js";
import {
  ARC_TESTNET_CHAIN,
  ARC_TESTNET_USDC_ADDRESS,
} from "../../infrastructure/arc/arc-testnet.constants.js";
import { ArcVaultReaderAdapter } from "../../infrastructure/arc/arc-vault-reader.adapter.js";
import { CircleAuthorizationReceiptSignerAdapter } from "../../infrastructure/circle/circle-authorization-receipt-signer.adapter.js";
import { CircleTreasuryPaymentAdapter } from "../../infrastructure/circle/circle-treasury-payment.adapter.js";
import { CircleVaultAuthorizationSignerAdapter } from "../../infrastructure/circle/circle-vault-authorization-signer.adapter.js";
import { SqlitePaymentWorkflowRepository } from "../../infrastructure/persistence/sqlite-payment-workflow.repository.js";
import { parseCanonicalEvmAddress } from "../../shared/validation/evm.js";
import { createPaymentWorkflowServer } from "./payment-workflow.server.js";

const operatorToken = process.env.ATTESTPAY_OPERATOR_TOKEN;
if (!operatorToken) throw new Error("ATTESTPAY_OPERATOR_TOKEN is required.");
const databasePath = resolve(
  process.env.ATTESTPAY_DATABASE_PATH ?? "local-state/attestpay.sqlite",
);
const port = Number(process.env.PORT ?? "3100");
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be a valid TCP port.");
}

const treasury = loadCircleTreasuryConfig();
const vault = loadAttestPayVaultConfig();
const operator = loadAttestPayOperatorConfig();
const authorizer = loadCircleVaultAuthorizerConfig();
const trustedDeployment: TrustedPaymentDeploymentContext = Object.freeze({
  chainId: BigInt(ARC_TESTNET_CHAIN.id),
  vaultAddress: parseCanonicalEvmAddress(vault.address),
  usdcTokenAddress: parseCanonicalEvmAddress(ARC_TESTNET_USDC_ADDRESS),
});
const repository = new SqlitePaymentWorkflowRepository(databasePath);
const payments = new CircleTreasuryPaymentAdapter(treasury);
const vaultReader = new ArcVaultReaderAdapter();
const vaultSigner = new CircleVaultAuthorizationSignerAdapter(authorizer);
const receiptSigner = new CircleAuthorizationReceiptSignerAdapter(authorizer);
const settlementVerifier = new ArcSettlementVerifierAdapter();

const server = createPaymentWorkflowServer({
  repository,
  operatorToken,
  operatorId: operator.id,
  approverAddress: authorizer.walletAddress,
  trustedDeployment,
  receiptSigner,
  executeWorkflow: (workflowId, occurredAt) =>
    executeAuthorizedPayment({
      workflowId,
      repository,
      trustedDeployment,
      vaultReader,
      vaultSigner,
      payments,
      settlementVerifier,
      executorAddress: treasury.walletAddress,
      occurredAt,
      waitSignal: AbortSignal.timeout(180_000),
    }),
});

server.listen(port, "127.0.0.1", () => {
  console.log(`AttestPay operations available at http://127.0.0.1:${port}`);
});

function close(): void {
  server.close(() => {
    repository.close();
    process.exit(0);
  });
}
process.once("SIGINT", close);
process.once("SIGTERM", close);
