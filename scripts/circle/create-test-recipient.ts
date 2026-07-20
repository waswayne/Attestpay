import { randomUUID } from "node:crypto";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { isAddress, isHex, size } from "viem";
import { saveLocalEnvironmentValue } from "./local-environment-file.js";

const apiKey = process.env.CIRCLE_API_KEY?.trim();
const entitySecret = process.env.CIRCLE_ENTITY_SECRET?.trim();
const walletSetId = process.env.CIRCLE_WALLET_SET_ID?.trim();
const treasuryWalletId = process.env.CIRCLE_WALLET_ID?.trim();

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
  throw new Error("Create the treasury wallet before creating a test recipient.");
}

const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
const walletSetResponse = await client.getWalletSet({ id: walletSetId });

if (walletSetResponse.data?.walletSet?.id !== walletSetId) {
  throw new Error("The configured Circle wallet set could not be verified.");
}

let recipientWalletId = process.env.CIRCLE_TEST_RECIPIENT_WALLET_ID?.trim();

if (!recipientWalletId) {
  const idempotencyKey =
    process.env.CIRCLE_TEST_RECIPIENT_IDEMPOTENCY_KEY?.trim() ?? randomUUID();

  // Persist before the external request so a retry cannot create a second wallet.
  await saveLocalEnvironmentValue(
    "CIRCLE_TEST_RECIPIENT_IDEMPOTENCY_KEY",
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
    throw new Error(`Expected one test recipient, received ${wallets.length}.`);
  }

  recipientWalletId = wallets[0].id;
  await saveLocalEnvironmentValue(
    "CIRCLE_TEST_RECIPIENT_WALLET_ID",
    recipientWalletId,
  );
}

const response = await client.getWallet({ id: recipientWalletId });
const recipient = response.data?.wallet;

if (!recipient) {
  throw new Error("The Circle test-recipient wallet could not be verified.");
}

if (
  recipient.id === treasuryWalletId ||
  recipient.walletSetId !== walletSetId ||
  recipient.blockchain !== "ARC-TESTNET" ||
  recipient.accountType !== "EOA" ||
  !isAddress(recipient.address, { strict: false })
) {
  throw new Error("The test recipient does not match the required wallet boundary.");
}

await saveLocalEnvironmentValue(
  "CIRCLE_TEST_RECIPIENT_ADDRESS",
  recipient.address,
);

console.log("Controlled test recipient is ready:");
console.log(`  Wallet ID: ${recipient.id}`);
console.log(`  Address: ${recipient.address}`);
console.log(`  Network: ${recipient.blockchain}`);
