import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createPaymentWorkflow } from "../src/application/use-cases/manage-payment-workflow.js";
import { createCanonicalInvoice } from "../src/domain/invoices/invoice.js";
import {
  evaluateCanonicalPayment,
  type CanonicalPaymentEvaluationInput,
} from "../src/domain/policies/canonical-payment-decision.js";
import { sha256Bytes } from "../src/domain/shared/canonical-record.js";
import { createCanonicalVendor } from "../src/domain/vendors/vendor.js";
import { createCanonicalWorkOrder } from "../src/domain/work-orders/work-order.js";
import { ARC_TESTNET_CHAIN, ARC_TESTNET_USDC_ADDRESS } from "../src/infrastructure/arc/arc-testnet.constants.js";
import { SqlitePaymentWorkflowRepository } from "../src/infrastructure/persistence/sqlite-payment-workflow.repository.js";
import { parseCanonicalEvmAddress } from "../src/shared/validation/evm.js";

const authorizer = requiredAddress("ATTESTPAY_DEMO_AUTHORIZER_ADDRESS");
const vaultAddress = requiredAddress("ATTESTPAY_DEMO_VAULT_ADDRESS");
const recipientAddress = requiredAddress("ATTESTPAY_DEMO_RECIPIENT_ADDRESS");
const changedRecipient = parseCanonicalEvmAddress(
  "0x4444444444444444444444444444444444444444",
);
const databasePath = resolve(
  process.env.ATTESTPAY_DATABASE_PATH ?? "local-state/attestpay.sqlite",
);
const repository = new SqlitePaymentWorkflowRepository(databasePath);
const now = new Date();
const issuedAt = now.toISOString();
const expiresAt = new Date(now.getTime() + 30 * 60_000).toISOString();

try {
  const scenarios = [
    scenario("routine", 500_000_000n, recipientAddress, false),
    scenario("duplicate", 500_000_000n, recipientAddress, true),
    scenario("recipient-change", 500_000_000n, changedRecipient, false),
    scenario("unusual-amount", 750_000_000n, recipientAddress, false),
  ];
  for (const item of scenarios) {
    const id = `demo-${item.name}`;
    if (await repository.get(id)) {
      console.log(`Kept existing ${id}.`);
      continue;
    }
    const evaluation = evaluateCanonicalPayment(item.input);
    const workflow = await createPaymentWorkflow(repository, {
      id,
      idempotencyKey: randomUUID(),
      decision: evaluation.decision,
      decisionHash: evaluation.decisionHash,
      policyDefinitionHash: evaluation.policyDefinitionHash,
      policyInputHash: evaluation.canonicalInputHash,
      authorizer,
      chainId: BigInt(ARC_TESTNET_CHAIN.id),
      vaultAddress,
      recipientAddress: item.input.invoice.proposedRecipientAddress,
      usdcTokenAddress: parseCanonicalEvmAddress(ARC_TESTNET_USDC_ADDRESS),
      amountBaseUnits: item.input.invoice.amountBaseUnits,
      paymentReference: `payment-${item.name}`,
      nonce: `authorization-${item.name}-001`,
      issuedAt,
      expiresAt,
      createdAt: issuedAt,
    });
    console.log(`Created ${workflow.id}: ${workflow.state}.`);
  }
  console.log(`Demo workflows are stored in ${databasePath}.`);
} finally {
  repository.close();
}

function scenario(
  name: string,
  amountBaseUnits: bigint,
  proposedRecipientAddress: ReturnType<typeof parseCanonicalEvmAddress>,
  duplicate: boolean,
): { name: string; input: CanonicalPaymentEvaluationInput } {
  const vendor = createCanonicalVendor({
    id: `vendor-${name}`,
    displayName: "Synthetic Design Cooperative",
    verifiedWalletAddress: recipientAddress,
    verificationStatus: "VERIFIED",
    active: true,
    verificationMethod: "ADMIN_CONFIRMATION",
    verificationEvidenceReference: `verification-${name}`,
  });
  const workOrder = createCanonicalWorkOrder({
    id: `work-order-${name}`,
    vendorId: vendor.id,
    externalReference: `PO-${name}`,
    maximumAmountBaseUnits: 2_000_000_000n,
    committedAmountBaseUnits: 0n,
    currency: "USDC",
    validFrom: new Date(now.getTime() - 24 * 60 * 60_000).toISOString(),
    validUntil: new Date(now.getTime() + 30 * 24 * 60 * 60_000).toISOString(),
    status: "ACTIVE",
  });
  const invoice = createCanonicalInvoice({
    id: `invoice-${name}`,
    vendorId: vendor.id,
    workOrderId: workOrder.id,
    invoiceNumber: `INV-${name}`,
    amountBaseUnits,
    currency: "USDC",
    proposedRecipientAddress,
    rawFileHash: sha256Bytes(Buffer.from(`synthetic invoice ${name}`, "utf8")),
    criticalFieldProvenanceState: "COMPLETE",
  });
  return {
    name,
    input: {
      vendor,
      workOrder,
      invoice,
      treasurySpendRecords: [],
      duplicateEvidence: {
        fileHashPreviouslySeen: duplicate,
        fingerprintPreviouslySeen: duplicate,
        invoiceNumberPreviouslySeenForVendor: duplicate,
      },
      evaluatedAt: issuedAt,
    },
  };
}

function requiredAddress(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return parseCanonicalEvmAddress(value);
}
