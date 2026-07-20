import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const environmentFile = new URL("../../.env.local", import.meta.url);

let existingEnvironment = "";
try {
  existingEnvironment = await readFile(environmentFile, "utf8");
} catch (error: unknown) {
  const errorCode =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : undefined;

  if (errorCode !== "ENOENT") {
    throw error;
  }
}

if (/^CIRCLE_ENTITY_SECRET=\S+/m.test(existingEnvironment)) {
  console.error(
    "Stopped: .env.local already contains an entity secret. It was not overwritten.",
  );
  process.exitCode = 1;
} else {
  // Circle defines an entity secret as a cryptographically random 32-byte key.
  // Generate it directly because the SDK helper prints the value to stdout.
  const entitySecret = randomBytes(32).toString("hex");
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

  console.log("Entity secret generated and saved privately in .env.local.");
  console.log("The secret was intentionally not printed to the terminal.");
}
