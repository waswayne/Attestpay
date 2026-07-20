# AttestPay Engineering Standards

This document defines the engineering constraints used to keep AttestPay
secure, maintainable, testable, and operationally understandable.

## System Design

Every material design decision must identify:

- The functional outcome and relevant non-functional requirements.
- The component that owns the capability and its canonical data.
- The trust boundaries crossed by the data flow.
- The consistency, availability, latency, and recovery expectations.
- Failure modes for internal and external dependencies.
- The selected tradeoff and credible alternatives considered.

The default architecture is a modular monolith. New services require an
operational or scaling reason that outweighs the cost of distributed
transactions, deployment coordination, and cross-service observability.

## Dependency Direction

Dependencies point toward the domain:

```text
interfaces -> application -> domain
                   ^
                   |
             infrastructure
```

- Domain modules contain deterministic business rules and import no framework,
  database, AI provider, wallet SDK, or blockchain client.
- Application modules coordinate use cases through typed ports.
- Infrastructure modules implement ports for Circle, Arc, persistence, private
  files, extraction providers, and signing.
- Interface modules authenticate, authorize, validate, and translate external
  requests into application commands.

## Backend Standards

### Boundary validation

- Validate every external payload before it reaches application logic.
- Normalize values once at the boundary and preserve canonical forms internally.
- Treat uploaded files, model output, webhooks, and blockchain responses as
  untrusted input.
- Return stable error contracts without leaking credentials or internal details.

### Authentication and authorization

- Enforce identity and permission checks on the server.
- Bind approval to the exact recipient, amount, asset, invoice hash, policy
  version, nonce, and expiry.
- Never treat possession of a client-side route or UI state as authorization.

### Persistence and transactions

- Store canonical business state in a migration-managed relational database.
- Make related state transitions atomic where partial completion would violate
  an invariant.
- Use explicit uniqueness constraints for duplicate-sensitive records.
- Keep an append-only audit event for security-relevant decisions and actions.

### Idempotency and external calls

- Persist idempotency keys before initiating payment-affecting requests.
- Reuse the same key when retrying the same logical operation.
- Treat timeouts as ambiguous outcomes until the external system is reconciled.
- Do not blindly retry non-idempotent operations.
- Separate request submission from settlement confirmation.

### Errors and observability

- Translate provider errors into intentional application error types.
- Use structured logs with correlation identifiers and no secret values.
- Record metrics for decision outcomes, approval latency, payment failures, and
  reconciliation lag.
- Make every payment traceable from invoice to decision, approval, provider
  request, transaction, and settlement evidence.

## Smart Contract Standards

### Asset and authority model

- Document every address that can move, pause, recover, or redirect assets.
- Apply least privilege to executor and administrator roles.
- Reject zero addresses, unsupported assets, expired authorizations, and reused
  authorization identifiers.
- Keep privileged behavior visible through explicit events.

### State and call safety

- Define invariants before implementation.
- Follow checks-effects-interactions around external calls.
- Use established token and access-control libraries instead of custom
  implementations.
- Protect reentrant surfaces when state or asset safety depends on call order.
- Avoid upgradeability unless a concrete requirement and governance model
  justify its additional authority and storage risk.

### Authorization and replay protection

- Bind signatures to the chain ID, verifying contract, action fields, nonce, and
  deadline.
- Consume a unique authorization identifier exactly once.
- Reject changes to recipient, amount, asset, invoice, or policy version after
  approval.

### Events and reconciliation

- Emit events for authorization consumption, payment execution, administrative
  changes, and failed or cancelled workflows where applicable.
- Treat transaction success alone as insufficient; reconciliation must verify
  the expected contract and token events.
- Keep onchain identifiers deterministic and avoid exposing raw private records.

## Dependency Selection

Before adding a package:

1. Check whether the language standard library, Circle SDK, Arc platform, EVM
   standard, or an installed dependency already provides the capability.
2. Read the current official documentation and confirm platform compatibility.
3. Define the module that will own the dependency.
4. Classify it as a runtime or development dependency.
5. Prefer established, narrowly scoped libraries over custom cryptography,
   token standards, signature verification, validation, or access control.
6. Commit the lockfile and run the package audit and relevant verification.

Dependencies must remove more risk or implementation work than the complexity
they introduce.

## Testing Standards

- Domain rules require deterministic unit and policy-table tests.
- Application use cases require success, authorization, conflict, and provider
  failure tests.
- Infrastructure adapters require integration tests against controlled external
  environments or faithful protocol fixtures.
- Contracts require unit, authorization, replay, reentrancy, event, fuzz, and
  invariant tests in proportion to the asset risk.
- Critical user workflows require browser-level verification.
- External settlement flows require a recorded transaction hash and verified
  receipt or event evidence.

## Definition of Done

A capability is complete when, in proportion to its risk:

- Ownership and interfaces are clear.
- Inputs and outputs are typed and validated.
- Authorization and failure behavior are intentional.
- Idempotency and transaction boundaries are addressed.
- Tests cover the core success and failure paths.
- Logs and audit records make the result diagnosable.
- Documentation describes the implemented state without overclaiming.
- The real command, API, contract, or user workflow has been verified.
