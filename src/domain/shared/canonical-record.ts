import { createHash } from "node:crypto";

export type Sha256Hash = `sha256:${string}`;

export type CanonicalValue =
  | string
  | boolean
  | null
  | readonly CanonicalValue[];

export type CanonicalField = readonly [name: string, value: CanonicalValue];

const STABLE_IDENTIFIER_PATTERN =
  /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/;
const CANONICAL_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SHA_256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const RFC_3339_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function requireStableIdentifier(value: string, label: string): string {
  const normalized = value.trim();

  if (!STABLE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a stable non-empty identifier.`);
  }

  return normalized;
}

export function requireCanonicalInstant(value: string, label: string): string {
  const normalized = value.trim();

  if (!RFC_3339_INSTANT_PATTERN.test(normalized)) {
    throw new Error(`${label} must be an RFC 3339 timestamp with a time zone.`);
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} must be a valid timestamp.`);
  }

  return parsed.toISOString();
}

export function requireSha256Hash(value: string, label: string): Sha256Hash {
  const normalized = value.trim().toLowerCase();

  if (!SHA_256_PATTERN.test(normalized)) {
    throw new Error(`${label} must use the sha256:<64 lowercase hex> format.`);
  }

  return normalized as Sha256Hash;
}

export function bigintToCanonicalDecimal(value: bigint): string {
  return value.toString(10);
}

function assertCanonicalValue(value: CanonicalValue, path: string): void {
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${path} contains an unsupported canonical value.`);
  }

  value.forEach((item, index) =>
    assertCanonicalValue(item, `${path}[${index}]`),
  );
}

/**
 * Serializes an explicitly ordered record without relying on object-key order.
 * Numbers are intentionally unsupported; financial bigints must be decimal strings.
 */
export function serializeCanonicalRecord(
  schemaVersion: string,
  fields: readonly CanonicalField[],
): string {
  if (!CANONICAL_VERSION_PATTERN.test(schemaVersion)) {
    throw new Error("Canonical schema version must be a stable identifier.");
  }

  const fieldNames = new Set<string>();
  for (const [name, value] of fields) {
    if (!STABLE_IDENTIFIER_PATTERN.test(name) || fieldNames.has(name)) {
      throw new Error("Canonical field names must be stable and unique.");
    }
    fieldNames.add(name);
    assertCanonicalValue(value, name);
  }

  return JSON.stringify([
    schemaVersion,
    fields.map(([name, value]) => [name, value]),
  ]);
}

export function sha256CanonicalRecord(
  schemaVersion: string,
  fields: readonly CanonicalField[],
): Sha256Hash {
  const canonicalRecord = serializeCanonicalRecord(schemaVersion, fields);
  const digest = createHash("sha256").update(canonicalRecord, "utf8").digest("hex");
  return `sha256:${digest}`;
}

export function sha256Bytes(value: Uint8Array): Sha256Hash {
  const digest = createHash("sha256").update(value).digest("hex");
  return `sha256:${digest}`;
}
