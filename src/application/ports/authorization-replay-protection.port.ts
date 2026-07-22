import type { Sha256Hash } from "../../domain/shared/canonical-record.js";

export type ConsumeAuthorizationReplayKey = Readonly<{
  replayKey: Sha256Hash;
  receiptHash: Sha256Hash;
}>;

/**
 * Implementations must atomically return true only for the first consumption
 * of a replay key. A check followed by a separate write is not sufficient.
 */
export interface AuthorizationReplayProtectionPort {
  consume(input: ConsumeAuthorizationReplayKey): Promise<boolean>;
}
