import { randomUUID } from "node:crypto";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { isAddress, isHex, size } from "viem";
import { saveLocalEnvironmentValue } from "./local-environment-file.js";

type TreasuryWallet = {
  id: string;
  address: string;
  blockchain: string;
  accountType: string;
  walletSetId: string;
};

const apiKey = process.env.CIRCLE_API_KEY?.trim();
const entitySecret = process.env.CIRCLE_ENTITY_SECRET?.trim();

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

async function getOrCreateIdempotencyKey(name: string): Promise<string> {
  const existingKey = process.env[name]?.trim();
  if (existingKey) {
    return existingKey;
  }

  const newKey = randomUUID();
  await saveLocalEnvironmentValue(name, newKey);
  return newKey;
}

const client = initiateDeveloperControlledWalletsClient({
  apiKey,
  entitySecret,
});

let walletSetId = process.env.CIRCLE_WALLET_SET_ID?.trim();

if (!walletSetId) {
  const idempotencyKey = await getOrCreateIdempotencyKey(
    "CIRCLE_WALLET_SET_IDEMPOTENCY_KEY",
  );
  const response = await client.createWalletSet({
    name: "AttestPay Treasury",
    idempotencyKey,
  });

  walletSetId = response.data?.walletSet?.id;
  if (!walletSetId) {
    throw new Error("Circle created no verifiable wallet-set ID.");
  }

  await saveLocalEnvironmentValue("CIRCLE_WALLET_SET_ID", walletSetId);
  console.log(`Created wallet set: ${walletSetId}`);
} else {
  const response = await client.getWalletSet({ id: walletSetId });
  if (response.data?.walletSet?.id !== walletSetId) {
    throw new Error("The configured Circle wallet set could not be verified.");
  }
  console.log(`Reusing verified wallet set: ${walletSetId}`);
}

if (!walletSetId) {
  throw new Error("The Circle wallet-set ID is unavailable.");
}

let walletId = process.env.CIRCLE_WALLET_ID?.trim();
let wallet: TreasuryWallet | undefined;

if (!walletId) {
  const idempotencyKey = await getOrCreateIdempotencyKey(
    "CIRCLE_WALLET_IDEMPOTENCY_KEY",
  );
  const response = await client.createWallets({
    accountType: "EOA",
    blockchains: ["ARC-TESTNET"],
    count: 1,
    walletSetId,
    idempotencyKey,
  });

  const wallets = response.data?.wallets ?? [];
  if (wallets.length !== 1) {
    throw new Error(`Expected one Circle wallet, received ${wallets.length}.`);
  }

  const createdWallet = wallets[0];
  if (!createdWallet) {
    throw new Error("Circle did not return the created wallet.");
  }

  wallet = createdWallet;
  walletId = wallet.id;
  await saveLocalEnvironmentValue("CIRCLE_WALLET_ID", walletId);
} else {
  const response = await client.getWallet({ id: walletId });
  wallet = response.data?.wallet;
}

if (!wallet) {
  throw new Error("The Circle wallet could not be verified.");
}

if (wallet.walletSetId !== walletSetId) {
  throw new Error("The wallet does not belong to the configured wallet set.");
}

if (wallet.blockchain !== "ARC-TESTNET" || wallet.accountType !== "EOA") {
  throw new Error(
    `Expected an ARC-TESTNET EOA, received ${wallet.blockchain} ${wallet.accountType}.`,
  );
}

if (!isAddress(wallet.address, { strict: false })) {
  throw new Error("Circle returned an invalid EVM wallet address.");
}

await saveLocalEnvironmentValue("CIRCLE_WALLET_ADDRESS", wallet.address);

console.log("AttestPay treasury wallet is ready:");
console.log(`  Wallet ID: ${wallet.id}`);
console.log(`  Address: ${wallet.address}`);
console.log(`  Network: ${wallet.blockchain}`);
console.log(`  Account type: ${wallet.accountType}`);
