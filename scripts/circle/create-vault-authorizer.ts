import { randomUUID } from "node:crypto";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { isAddress, isHex, size } from "viem";
import { saveLocalEnvironmentValue } from "./local-environment-file.js";

const apiKey = process.env.CIRCLE_API_KEY?.trim();
const entitySecret = process.env.CIRCLE_ENTITY_SECRET?.trim();
const walletSetId = process.env.CIRCLE_WALLET_SET_ID?.trim();
const treasuryWalletId = process.env.CIRCLE_WALLET_ID?.trim();
const recipientWalletId = process.env.CIRCLE_TEST_RECIPIENT_WALLET_ID?.trim();

if (!apiKey?.startsWith("TEST_API_KEY:")) {
  throw new Error("CIRCLE_API_KEY must be a Circle Testnet API key.");
}
if (
  !entitySecret ||
  !isHex(`0x${entitySecret}`) ||
  size(`0x${entitySecret}`) !== 32
) {
  throw new Error("CIRCLE_ENTITY_SECRET must be a 64-character hexadecimal value.");
}
if (!walletSetId || !treasuryWalletId) {
  throw new Error("Create the treasury wallet before creating the vault authorizer.");
}

const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
const walletSetResponse = await client.getWalletSet({ id: walletSetId });
if (walletSetResponse.data?.walletSet?.id !== walletSetId) {
  throw new Error("The configured Circle wallet set could not be verified.");
}

let authorizerWalletId = process.env.CIRCLE_VAULT_AUTHORIZER_WALLET_ID?.trim();

if (!authorizerWalletId) {
  const idempotencyKey =
    process.env.CIRCLE_VAULT_AUTHORIZER_IDEMPOTENCY_KEY?.trim() ?? randomUUID();

  // Persist before Circle is called so a retry cannot create another signing wallet.
  await saveLocalEnvironmentValue(
    "CIRCLE_VAULT_AUTHORIZER_IDEMPOTENCY_KEY",
    idempotencyKey,
  );

  const response = await client.createWallets({
    accountType: "EOA",
    blockchains: ["ARC-TESTNET"],
    count: 1,
    walletSetId,
    idempotencyKey,
  });
  const wallets = response.data?.wallets ?? [];
  if (wallets.length !== 1 || !wallets[0]) {
    throw new Error(`Expected one vault authorizer, received ${wallets.length}.`);
  }

  authorizerWalletId = wallets[0].id;
  await saveLocalEnvironmentValue(
    "CIRCLE_VAULT_AUTHORIZER_WALLET_ID",
    authorizerWalletId,
  );
}

const response = await client.getWallet({ id: authorizerWalletId });
const authorizer = response.data?.wallet;
if (!authorizer) {
  throw new Error("The Circle vault-authorizer wallet could not be verified.");
}

if (
  authorizer.id === treasuryWalletId ||
  authorizer.id === recipientWalletId ||
  authorizer.walletSetId !== walletSetId ||
  authorizer.blockchain !== "ARC-TESTNET" ||
  authorizer.accountType !== "EOA" ||
  !isAddress(authorizer.address, { strict: false })
) {
  throw new Error("The vault authorizer does not match the required wallet boundary.");
}

await saveLocalEnvironmentValue(
  "CIRCLE_VAULT_AUTHORIZER_ADDRESS",
  authorizer.address,
);

console.log("AttestPay vault authorizer is ready:");
console.log(`  Wallet ID: ${authorizer.id}`);
console.log(`  Address: ${authorizer.address}`);
console.log(`  Network: ${authorizer.blockchain}`);
console.log("  Authority: signs payment instructions; cannot submit vault payments");
