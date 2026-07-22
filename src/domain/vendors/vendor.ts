import type { CanonicalEvmAddress } from "../shared/canonical-evm-address.js";
import { requireStableIdentifier } from "../shared/canonical-record.js";

export type VendorVerificationStatus =
  | "VERIFIED"
  | "PENDING"
  | "SUSPENDED"
  | "REVOKED";

export type VendorVerificationMethod =
  | "ADMIN_CONFIRMATION"
  | "SIGNED_WALLET_CHALLENGE"
  | "IN_PERSON";

export type CanonicalVendor = Readonly<{
  id: string;
  displayName: string;
  verifiedWalletAddress: CanonicalEvmAddress | null;
  verificationStatus: VendorVerificationStatus;
  active: boolean;
  verificationMethod: VendorVerificationMethod | null;
  verificationEvidenceReference: string | null;
}>;

const VERIFICATION_STATUSES: readonly VendorVerificationStatus[] = [
  "VERIFIED",
  "PENDING",
  "SUSPENDED",
  "REVOKED",
];

const VERIFICATION_METHODS: readonly VendorVerificationMethod[] = [
  "ADMIN_CONFIRMATION",
  "SIGNED_WALLET_CHALLENGE",
  "IN_PERSON",
];

export function createCanonicalVendor(input: {
  id: string;
  displayName: string;
  verifiedWalletAddress: CanonicalEvmAddress | null;
  verificationStatus: VendorVerificationStatus;
  active: boolean;
  verificationMethod: VendorVerificationMethod | null;
  verificationEvidenceReference: string | null;
}): CanonicalVendor {
  const id = requireStableIdentifier(input.id, "Vendor ID");
  const displayName = input.displayName.normalize("NFKC").trim().replace(/\s+/gu, " ");

  if (!displayName || displayName.length > 200) {
    throw new Error("Vendor display name must contain 1 to 200 characters.");
  }
  if (!VERIFICATION_STATUSES.includes(input.verificationStatus)) {
    throw new Error("Vendor verification status is invalid.");
  }
  if (
    input.verificationMethod !== null &&
    !VERIFICATION_METHODS.includes(input.verificationMethod)
  ) {
    throw new Error("Vendor verification method is invalid.");
  }

  const hasAnyVerificationEvidence =
    input.verifiedWalletAddress !== null ||
    input.verificationMethod !== null ||
    input.verificationEvidenceReference !== null;
  const hasCompleteVerificationEvidence =
    input.verifiedWalletAddress !== null &&
    input.verificationMethod !== null &&
    input.verificationEvidenceReference !== null;
  const verificationEvidenceReference =
    input.verificationEvidenceReference === null
      ? null
      : requireStableIdentifier(
          input.verificationEvidenceReference,
          "Vendor verification evidence reference",
        );

  if (input.verificationStatus === "PENDING" && hasAnyVerificationEvidence) {
    throw new Error("A pending vendor cannot own trusted verification evidence.");
  }
  if (input.verificationStatus === "PENDING" && input.active) {
    throw new Error("A pending vendor cannot be active.");
  }
  if (
    input.verificationStatus !== "PENDING" &&
    !hasCompleteVerificationEvidence
  ) {
    throw new Error(
      "Verified, suspended, and revoked vendors require wallet verification evidence.",
    );
  }
  if (
    (input.verificationStatus === "SUSPENDED" ||
      input.verificationStatus === "REVOKED") &&
    input.active
  ) {
    throw new Error("A suspended or revoked vendor cannot be active.");
  }

  return Object.freeze({
    id,
    displayName,
    verifiedWalletAddress: input.verifiedWalletAddress,
    verificationStatus: input.verificationStatus,
    active: input.active,
    verificationMethod: input.verificationMethod,
    verificationEvidenceReference,
  });
}
