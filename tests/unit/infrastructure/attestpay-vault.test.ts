import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeFunctionData,
  keccak256,
  stringToHex,
  verifyTypedData,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { VaultPaymentAuthorization } from "../../../src/domain/payments/vault-payment-authorization.js";
import {
  ATTESTPAY_VAULT_ABI,
  getVaultPaymentTypedData,
  prepareArcVaultRecipientApproval,
  prepareArcVaultPayment,
} from "../../../src/infrastructure/arc/attestpay-vault.js";
import {
  ARC_MEMO_ABI,
  ARC_MEMO_ADDRESS,
} from "../../../src/infrastructure/arc/arc-memo.js";
import { CircleVaultAuthorizationSignerAdapter } from "../../../src/infrastructure/circle/circle-vault-authorization-signer.adapter.js";

const account = privateKeyToAccount(
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
const vaultAddress = "0x1111111111111111111111111111111111111111" as Address;
const recipient = "0x2222222222222222222222222222222222222222" as Address;

function authorization(): VaultPaymentAuthorization {
  return {
    paymentId: keccak256(stringToHex("payment-001")),
    recipient,
    amount: 25_000_000n,
    invoiceHash: keccak256(stringToHex("invoice-001")),
    policyHash: keccak256(stringToHex("policy-v1")),
    validAfter: 1_700_000_000,
    deadline: 1_700_003_600,
    authorizer: account.address,
  };
}

test("Circle signs the exact EIP-712 vault authorization", async () => {
  const payment = authorization();
  const typedData = getVaultPaymentTypedData(vaultAddress, payment);
  const signature = await account.signTypedData(typedData);
  let serializedData = "";

  const signer = new CircleVaultAuthorizationSignerAdapter(
    {
      apiKey: "TEST_API_KEY:test",
      entitySecret: "a".repeat(64),
      walletId: "11111111-1111-4111-8111-111111111111",
      walletAddress: account.address,
    },
    {
      async signTypedData(input) {
        serializedData = input.data;
        return { data: { signature } };
      },
    },
  );

  const result = await signer.signVaultPaymentAuthorization({
    vaultAddress,
    authorization: payment,
    explanation: "Approve invoice-001 payment",
  });

  assert.equal(result, signature);
  const circleTypedData = JSON.parse(serializedData);
  assert.equal(circleTypedData.primaryType, "PaymentAuthorization");
  assert.deepEqual(circleTypedData.domain, typedData.domain);
  assert.deepEqual(
    circleTypedData.types.EIP712Domain,
    [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
  );
  assert.equal(circleTypedData.message.amount, payment.amount.toString());
  assert.equal(
    await verifyTypedData({
      address: account.address,
      ...typedData,
      signature: result,
    }),
    true,
  );
});

test("encodes the signed vault call inside the Arc Memo contract", async () => {
  const payment = authorization();
  const signature = await account.signTypedData(
    getVaultPaymentTypedData(vaultAddress, payment),
  );
  const prepared = prepareArcVaultPayment({
    vaultAddress,
    authorization: payment,
    signature,
    authorizationReference: "auth-001",
  });

  const outer = decodeFunctionData({
    abi: ARC_MEMO_ABI,
    data: prepared.contractCallData,
  });
  assert.equal(outer.functionName, "memo");
  assert.equal(outer.args[0], vaultAddress);
  assert.equal(outer.args[1], prepared.vaultCallData);
  assert.equal(outer.args[2], prepared.memoId);

  const inner = decodeFunctionData({
    abi: ATTESTPAY_VAULT_ABI,
    data: prepared.vaultCallData,
  });
  assert.equal(inner.functionName, "executePayment");
  assert.equal(inner.args[0].paymentId, payment.paymentId);
  assert.equal(inner.args[0].amount, payment.amount);
  assert.equal(inner.args[1], signature);
  assert.match(ARC_MEMO_ADDRESS, /^0x[0-9a-fA-F]{40}$/);
});

test("encodes recipient approval inside an auditable Arc Memo call", () => {
  const prepared = prepareArcVaultRecipientApproval({
    vaultAddress,
    recipientAddress: recipient,
    approved: true,
    authorizationReference: "recipient-approval-001",
  });
  const outer = decodeFunctionData({
    abi: ARC_MEMO_ABI,
    data: prepared.contractCallData,
  });
  const inner = decodeFunctionData({
    abi: ATTESTPAY_VAULT_ABI,
    data: prepared.vaultCallData,
  });

  assert.equal(outer.functionName, "memo");
  assert.equal(outer.args[0], vaultAddress);
  assert.equal(inner.functionName, "setRecipientApproval");
  assert.equal(inner.args[0], recipient);
  assert.equal(inner.args[1], true);
});

test("a signature cannot be replayed against another vault", async () => {
  const payment = authorization();
  const signature = await account.signTypedData(
    getVaultPaymentTypedData(vaultAddress, payment),
  );
  const otherVault = "0x3333333333333333333333333333333333333333" as Address;

  assert.equal(
    await verifyTypedData({
      address: account.address,
      ...getVaultPaymentTypedData(otherVault, payment),
      signature: signature as Hex,
    }),
    false,
  );
});
