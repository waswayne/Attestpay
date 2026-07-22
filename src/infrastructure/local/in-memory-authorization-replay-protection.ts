import type {
  AuthorizationReplayProtectionPort,
  ConsumeAuthorizationReplayKey,
} from "../../application/ports/authorization-replay-protection.port.js";

/** Process-local test/demo scaffolding. This is not durable payment state. */
export class InMemoryAuthorizationReplayProtection
  implements AuthorizationReplayProtectionPort
{
  private readonly consumedKeys = new Set<string>();

  async consume(input: ConsumeAuthorizationReplayKey): Promise<boolean> {
    if (this.consumedKeys.has(input.replayKey)) return false;
    this.consumedKeys.add(input.replayKey);
    return true;
  }
}
