import { readFile, writeFile } from "node:fs/promises";
import { generateEntitySecret } from "@circle-fin/developer-controlled-wallets";

const environmentFile = new URL("../../.env.local", import.meta.url);

let existingEnvironment = "";
try {
  existingEnvironment = await readFile(environmentFile, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") {
    throw error;
  }
}

if (/^CIRCLE_ENTITY_SECRET=\S+/m.test(existingEnvironment)) {
  console.error(
    "Stopped: .env.local already contains an entity secret. It was not overwritten.",
  );
  process.exitCode = 1;
} else {
  const capturedOutput = [];
  const originalLog = console.log;

  try {
    console.log = (...values) => capturedOutput.push(values.join(" "));
    generateEntitySecret();
  } finally {
    console.log = originalLog;
  }

  const generatedOutput = capturedOutput.join("\n");
  const match = generatedOutput.match(/ENTITY SECRET:\s*([a-fA-F0-9]{64})/);

  if (!match) {
    throw new Error("Circle SDK did not produce an entity secret in the expected format.");
  }

  const entitySecret = match[1];
  let nextEnvironment = existingEnvironment;

  if (/^CIRCLE_ENTITY_SECRET=.*$/m.test(nextEnvironment)) {
    nextEnvironment = nextEnvironment.replace(
      /^CIRCLE_ENTITY_SECRET=.*$/m,
      `CIRCLE_ENTITY_SECRET=${entitySecret}`,
    );
  } else {
    if (nextEnvironment && !nextEnvironment.endsWith("\n")) {
      nextEnvironment += "\n";
    }
    nextEnvironment += `CIRCLE_ENTITY_SECRET=${entitySecret}\n`;
  }

  await writeFile(environmentFile, nextEnvironment, {
    encoding: "utf8",
    mode: 0o600,
  });

  originalLog("Entity secret generated and saved privately in .env.local.");
  originalLog("The secret was intentionally not printed to the terminal.");
}
