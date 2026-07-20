import { readFile, writeFile } from "node:fs/promises";

const environmentFile = new URL("../../.env.local", import.meta.url);
let environmentContents = await readFile(environmentFile, "utf8");

export async function saveLocalEnvironmentValue(
  name: string,
  value: string,
): Promise<void> {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name) || !value || /[\r\n]/.test(value)) {
    throw new Error(`Refusing to save an invalid ${name || "environment"} value.`);
  }

  const linePattern = new RegExp(`^${name}=.*$`, "m");
  if (linePattern.test(environmentContents)) {
    environmentContents = environmentContents.replace(
      linePattern,
      `${name}=${value}`,
    );
  } else {
    if (environmentContents && !environmentContents.endsWith("\n")) {
      environmentContents += "\n";
    }
    environmentContents += `${name}=${value}\n`;
  }

  await writeFile(environmentFile, environmentContents, {
    encoding: "utf8",
    mode: 0o600,
  });
}
