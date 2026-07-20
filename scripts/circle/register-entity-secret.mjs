import { mkdir, readdir } from "node:fs/promises";
import { registerEntitySecretCiphertext } from "@circle-fin/developer-controlled-wallets";

const apiKey = process.env.CIRCLE_API_KEY?.trim();
const entitySecret = process.env.CIRCLE_ENTITY_SECRET?.trim();

if (!apiKey) {
  throw new Error("CIRCLE_API_KEY is missing from .env.local.");
}

if (!apiKey.startsWith("TEST_API_KEY:")) {
  throw new Error("Refusing to continue: this command requires a Circle Testnet API key.");
}

if (!/^[a-fA-F0-9]{64}$/.test(entitySecret ?? "")) {
  throw new Error("CIRCLE_ENTITY_SECRET must be a 64-character hexadecimal value.");
}

const recoveryDirectory = "./recovery";
await mkdir(recoveryDirectory, { recursive: true });

const existingRecoveryFiles = (await readdir(recoveryDirectory)).filter((name) =>
  name.endsWith(".dat"),
);

if (existingRecoveryFiles.length > 0) {
  throw new Error(
    "A recovery file already exists. Registration was stopped to avoid creating or overwriting recovery material.",
  );
}

await registerEntitySecretCiphertext({
  apiKey,
  entitySecret,
  recoveryFileDownloadPath: recoveryDirectory,
});

const recoveryFiles = (await readdir(recoveryDirectory)).filter((name) =>
  name.endsWith(".dat"),
);

if (recoveryFiles.length !== 1) {
  throw new Error(
    "Circle completed the request, but exactly one local recovery file could not be verified.",
  );
}

console.log(`Verified recovery file: recovery/${recoveryFiles[0]}`);
