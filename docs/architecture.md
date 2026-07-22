# AttestPay Architecture

This document records the intended system boundaries and dependency rules. It
describes the direction of the codebase. The Circle-to-Arc vault path is
live-verified. Canonical business records, deterministic decision hashing,
local receipt verification, SQLite workflow persistence, and product-to-vault
orchestration are implemented and tested locally. Live execution of a
product-created receipt remains incomplete.

## Architectural Style

AttestPay will begin as a **modular monolith**: one deployable application with
clear internal modules. This keeps local development, database transactions,
deployment, and debugging simple while preventing business rules from becoming
tightly coupled to Circle, Arc, the web framework, or a database vendor.

A useful analogy is a well-organized office in one building. Finance, approvals,
and treasury are separate departments with controlled doors, but we do not rent
three buildings and install a network between them before the team needs that
complexity.

## Language and Tool Ownership

Circle and Arc are platforms, not programming languages. AttestPay uses the
standard language and tool for each execution environment:

| Responsibility | Language or tool | Boundary |
| --- | --- | --- |
| Web interface | TypeScript, React, Next.js | Presents application use cases; never holds wallet credentials |
| Backend and policy engine | Strict TypeScript | Owns validation, authorization, orchestration, and deterministic policy |
| Circle integration | TypeScript and Circle's official SDK | Implements the treasury-wallet adapter |
| Arc reads and contract calls | TypeScript and `viem` | Encodes calls and verifies receipts and events |
| Onchain vault | Solidity | Enforces the final asset-control invariants on Arc's EVM |
| Persistent data | SQL through migrations and an ORM | Stores canonical business state and audit records |

TypeScript gives the offchain system one typed language across the web,
backend, policy engine, and integration adapters. Solidity is isolated to the
onchain contract because it has a different execution model, security boundary,
and testing discipline. SQL remains explicit at the persistence boundary even
when an ORM generates queries.

Shell commands are used for setup and automation only. Business policy and
payment authorization must not live in shell scripts.

## Dependency Rule

Dependencies point inward:

```text
interfaces -> application -> domain
                   ^
                   |
             infrastructure
```

- **Domain** contains deterministic payment policy and state transitions. It
  imports no framework, database, AI provider, Circle SDK, or blockchain client.
- **Application** coordinates use cases such as evaluating an invoice,
  authorizing an exception, and executing an approved payment.
- **Infrastructure** implements application ports for Circle Wallets, Arc,
  persistence, private file storage, extraction providers, and receipt signing.
- **Interfaces** expose the use cases through HTTP routes, background jobs, and
  the user interface.

The domain defines what the system means. External services define how an
approved operation is performed.

## Target Repository Shape

```text
attestpay/
├── src/
│   ├── domain/
│   │   ├── invoices/
│   │   ├── policies/
│   │   ├── treasury/
│   │   ├── vendors/
│   │   ├── work-orders/
│   │   ├── approvals/
│   │   └── payments/
│   ├── application/
│   │   ├── ports/
│   │   └── use-cases/
│   ├── infrastructure/
│   │   ├── circle/
│   │   ├── arc/
│   │   ├── persistence/
│   │   ├── files/
│   │   └── extraction/
│   ├── interfaces/
│   │   ├── http/
│   │   └── jobs/
│   └── config/
├── contracts/
├── scripts/
│   └── circle/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── contract/
└── docs/
```

Directories will be created when they receive working code; empty placeholder
modules are intentionally avoided.

## Core Boundaries

### Invoice extraction is advisory

An extraction provider returns typed candidate facts. Its output is untrusted
until schema validation and business validation succeed. Model output never
calls the wallet adapter directly.

### Policy decisions are deterministic

The domain owns canonical vendor, work-order, invoice, and treasury-spend
records. The verified vendor record is the only trusted wallet source; an
invoice recipient remains an untrusted comparison value. Invalid verification
states, negative or overcommitted work orders, non-USDC financial records, and
invalid hashes fail closed before policy evaluation.

Canonical serialization uses versioned fixed-position arrays rather than JSON
object-property order. Bigint amounts are encoded as base-10 strings and hashed
with Node's SHA-256 implementation. Invoice fingerprints cover normalized
payment facts, canonical input hashes bind the complete decision evidence, and
policy-definition hashes bind the version, currency, automatic-payment limit,
and daily limit. Decision hashes bind that exact policy definition, the input
hash, final decision, and ordered rule results.

Given the same normalized records, caller-supplied evaluation instant, daily
spend records, duplicate evidence, and policy definition, the engine returns
the same hashes, per-rule evidence, and decision. The engine reads no clock and
performs no database, network, AI, Circle, or Arc calls. Policy-table tests cover
every implemented rule order and the precedence `BLOCK > REVIEW > PASS`.

Shared boundary validation uses `viem` for EVM validation, zero-address
rejection, and EIP-55 checksum normalization, then returns a branded canonical
address. Domain modules accept only that canonical type and do not import a
blockchain client, RPC capability, wallet, or network code.

### Lifecycle transitions are explicit

Invoice state advances only through `RECEIVED -> VALIDATED -> EVALUATED` and
then archival, with a separate rejection path. Payment state begins from the
deterministic policy decision: `AUTO_APPROVED`, `AWAITING_HUMAN_APPROVAL`, or
`BLOCKED`. Human review can produce `HUMAN_APPROVED` or `BLOCKED`; only automatic
or human-approved state can verify a receipt and become `AUTHORIZED`. Submission
and independently verified evidence advance it to `SUBMITTED` and `SETTLED`.
Invalid skips, duplicate terminal transitions, and settlement before submission
throw before persistence or external calls.

`SUBMITTED` is a durable reconciliation state, not a second execution attempt.
The persisted transaction ID and hash, prepared call, vault authorization,
receipt, receipt hash, and exact expected payment fields are revalidated before
the existing settlement verifier runs. A transient verifier failure leaves the
workflow unchanged and retryable. Retry never requests another receipt or vault
signature, prepares another payment, or invokes external submission. Optimistic
workflow versions and the audit-event primary key allow one concurrent attempt
to persist the single `SUBMITTED -> SETTLED` transition.

### Approval is bound to an exact action

`attestpay.authorization-receipt.v1` is a pure domain record. Its fixed-order
SHA-256 payload binds the schema, canonical decision hash, policy-definition
hash, policy-input hash, authorizing outcome, authorizer, intended Arc chain,
vault, recipient, USDC token, amount in base units, payment reference, nonce,
issue time, and expiry. Only `AUTO_APPROVED` and `HUMAN_APPROVED` are
authorizing outcomes; blocked or still-pending policy decisions cannot be
represented as valid receipts.

The Arc infrastructure boundary converts that record to EIP-712. The typed
message repeats every receipt field and includes the canonical SHA-256 receipt
hash. The EIP-712 domain independently binds the same chain ID and vault as the
verifying contract. Local verification validates canonical form, compares the
complete expected execution context, enforces an inclusive issue time and
exclusive expiry, recovers the EVM signer, and compares it with the canonical
expected authorizer. Malformed signatures, wrong signers, field mutation,
address ambiguity, and cross-chain, cross-vault, cross-token, cross-recipient,
amount, nonce, or decision-context reuse fail with typed result codes suitable
for future audit events.

Replay uniqueness is scoped to authorizer, chain, vault, and nonce. The
application port performs one atomic consume only after signature and context
verification. The SQLite repository enforces a unique replay key in the same
`BEGIN IMMEDIATE` transaction that persists the `AUTHORIZED` workflow version
and audit event. Optimistic versions reject concurrent stale transitions. The
in-memory adapter remains only for focused verifier tests. A storage exception
fails closed.

The application receipt and the deployed vault's execution-specific EIP-712
authorization remain distinct artifacts but are now linked deterministically.
The onchain `invoiceHash` is the policy-input digest, while `policyHash` is the
complete canonical application-receipt digest. The payment ID is domain-separated
over the receipt and replay key. The prepared vault call and idempotency key are
persisted before Circle submission; settlement stores the independently verified
Arc evidence. Receipt verification alone is still not proof of execution.

### Deployment context is server-owned

The application receives one typed trusted deployment context from startup:
`ARC_TESTNET_CHAIN.id`, the configured `ATTESTPAY_VAULT_ADDRESS`, and
`ARC_TESTNET_USDC_ADDRESS`. Workflow and receipt values are untrusted stored
claims for this comparison; they never define their own expected context.
Authorization checks the context before Circle receipt signing. Execution checks
it again before vault derivation, vault signing, calldata preparation, and
submission. Reconciliation repeats the same validation before settlement reads.
EVM address comparison is canonical, so casing cannot create a false mismatch.

### The local API owns mutations

The Node HTTP interface binds to `127.0.0.1`, requires a constant-time compared
bearer token for every workflow read or mutation, limits JSON request bodies,
and serves static assets with a restrictive Content Security Policy. Browser
code can request approval, receipt signing, or execution but cannot directly
change state, construct trusted addresses, or hold wallet credentials. The
single operator token is suitable only for the local prototype. The server
derives audit attribution from a validated `ATTESTPAY_OPERATOR_ID`, generates
approval IDs itself, and ignores browser-supplied identity fields. This is one
configured local operator identity, not proof of which individual human acted.
Deployment requires authenticated user identities, role assignment, sessions,
CSRF protection if cookies are adopted, and per-user audit attribution.

### Circle is behind a port

Application code depends on a treasury-wallet interface rather than directly on
the Circle SDK. The Circle adapter owns SDK initialization, request idempotency,
response validation, error translation, and transaction-status polling.

Read and write capabilities use separate ports. `TreasuryWalletPort` exposes
wallet identity and balances, while `TreasuryPaymentPort` is the narrower,
security-sensitive capability that can submit USDC transfers. An interface that
only needs to display balances should never receive the payment port.

### Arc reconciliation is independent

Submitting a Circle transaction is not proof of settlement. An Arc reconciler
verifies the transaction receipt and expected Memo, vault, and USDC events
before marking a payment settled.

Public Arc reads use `viem` with the official Arc Testnet RPC endpoints as a
fallback set. Reconciliation requires a successful receipt and an exact USDC
`Transfer` event match; Circle state or a transaction hash alone is insufficient.

### Memo identifiers expose no private invoice data

Memo-linked transfers call Arc Testnet's predeployed Memo contract at
`0x5294E9927c3306DcBaDb03fe70b92e01cCede505`. AttestPay derives the indexed
`memoId` as the Keccak-256 hash of a versioned, domain-separated authorization
reference. The public memo payload contains only the format marker
`attestpay:authorization:v1`; private invoice and approval data remains offchain.

Reconciliation verifies the ordered `BeforeMemo`, USDC `Transfer`, and `Memo`
events, including the original EOA sender, USDC target, transfer calldata hash,
memo ID, memo bytes, recipient, and amount.

### The vault owns protected funds

`AttestPayVault` is a non-upgradeable Solidity contract that holds the USDC
budget governed by AttestPay policy. Keeping protected funds in the vault is a
security boundary: an executor cannot bypass vault rules by calling USDC
directly from its own wallet.

Payment execution separates two capabilities:

- An account with `AUTHORIZER_ROLE` signs an EIP-712 authorization containing
  the payment ID, recipient, amount, invoice hash, policy hash, validity window,
  and authorizer address.
- An account with `EXECUTOR_ROLE` submits the signed authorization through the
  Arc Memo contract. Arc preserves this EOA as `msg.sender` at the vault.

The EIP-712 domain binds a signature to the Arc chain ID and one deployed vault.
The vault consumes each payment ID once, requires an approved recipient,
enforces per-payment and UTC-day aggregate limits, and transfers the exact
signed USDC amount. OpenZeppelin implementations provide EIP-712 hashing,
EOA/ERC-1271 signature checking, role management, safe ERC-20 calls, pausing,
and reentrancy protection.

The default administrator has a delayed two-step transfer process. It can
manage roles, unpause execution, and recover funds only while the vault is
paused. These are explicit trusted powers. The full invariants and residual
risks are recorded in `docs/vault-security.md`.

For the testnet prototype, the treasury EOA is both administrator and executor,
and the executor and authorizer wallets are controlled through the same Circle
entity credential. The onchain roles are separate, but production custody must
place administration, authorization, and execution in independent security
domains.

Every live vault operation is persisted under the ignored `local-state/`
directory before its first mutating Circle request. A retry must reproduce the
same vault, recipient, amount, invoice reference, policy reference, EIP-712
window, and idempotency key. Once submitted, the operation resumes the original
Circle transaction instead of creating another payment.

Vault payment reconciliation requires one successful Arc receipt containing
the exact ordered evidence `BeforeMemo -> Transfer -> PaymentExecuted -> Memo`.
The USDC transfer must originate from the vault, the vault event must bind the
executor and authorizer, and the memo must bind the hash of the executed vault
calldata.

### Arc USDC has one canonical application balance

Arc exposes one underlying USDC balance through a native gas interface and an
ERC-20 interface. Infrastructure adapters remove the duplicate native view when
the ERC-20 view is present. Application accounting, transfers, approvals, and
allowances use the standard 6-decimal ERC-20 interface; native precision remains
an infrastructure concern for gas estimation and transaction construction.

## Existing External Capabilities We Reuse

- Circle's developer-controlled wallet SDK handles entity-secret ciphertext
  generation and re-encryption for wallet operations.
- Circle Wallets manages the server-controlled EOA and transaction submission.
- Arc's predeployed Memo contract attaches reconciliation metadata while
  preserving the original EOA as `msg.sender`.
- Standard ERC-20 interfaces handle USDC interaction.
- Established contract libraries provide access control, signature, token,
  and reentrancy primitives rather than custom implementations.

AttestPay implements its product-specific policy, authorization receipt, and
audit model. It does not reimplement wallet cryptography, token standards, or
general-purpose contract security components.

## Configuration and State

- Secrets come from environment variables locally and a secrets manager in a
  deployed environment.
- Generated wallet identifiers are stored in `.env.local` only during the
  integration spike. The operations server itself does not automatically load
  that file.
- Local product state uses migration-managed SQLite under ignored `local-state/`
  by default. It stores complete workflow snapshots, ordered audit events, and
  unique authorization replay keys. PostgreSQL remains the deployment target.
- Idempotency keys are generated before submission and persisted with the
  payment workflow and prepared call.
- During the external integration spike, ignored `local-state/` records persist
  each test-transfer payload and idempotency key before Circle is called. This is
  crash-safe retry scaffolding, not the final system of record.
- Raw invoices remain private and offchain. Only hashes and deliberately chosen
  receipt identifiers are eligible for onchain metadata.

## Decisions Recorded So Far

1. Use an EOA, not an SCA, because the Arc Memo contract requires a direct EOA
   caller.
2. Use the official Circle SDK so entity-secret ciphertext is regenerated for
   every sensitive request.
3. Prove the Circle-to-Arc transaction path before expanding the product UI.
4. Keep domain policy independent of AI and blockchain integrations.
5. Keep one deployment unit until scale or operational ownership justifies a
   service split.
6. Use strict TypeScript for all offchain product code, Solidity for Arc smart
   contracts, and migration-managed SQL for persistent state.
7. Separate treasury observation from payment authority through distinct
   application ports.
8. Put policy-protected USDC in a non-upgradeable vault rather than relying on
   an EOA to voluntarily call policy code.
9. Separate EIP-712 authorization from transaction execution and bind every
   approval to one chain, vault, payment, recipient, amount, invoice, policy,
   validity window, and signer.
10. Use OpenZeppelin Contracts and Hardhat's native Solidity/fuzz test runner
    instead of implementing cryptography or an EVM test harness.
11. Make independently verified vendor records the sole source of trusted
    recipient wallets; invoice recipients remain untrusted comparison inputs.
12. Use SHA-256 over explicit versioned arrays for invoice fingerprints, policy
    definitions, canonical policy inputs, and ordered policy decisions; bigint
    amounts are encoded as decimal strings.
13. Require callers to supply the canonical evaluation instant and daily spend
    records so the policy engine remains clock-free and deterministic.
14. Hash authorization receipts with the existing versioned fixed-order
    canonical format, then sign the complete receipt through EIP-712 at the Arc
    boundary; domain receipt types do not import `viem`.
15. Consume replay keys atomically only after local context, time-window, and
    signer verification; persistence failures deny authorization.
16. Use built-in SQLite for the dependency-free local product slice and retain
    PostgreSQL as the deployment persistence decision.
17. Derive the vault instruction only from a verified product receipt and make
    the vault policy hash equal the complete receipt digest.
18. Keep all browser mutations behind a bearer-protected backend; never expose
    wallet credentials or make frontend state authoritative.
19. Treat Arc chain ID, configured vault, and canonical Arc USDC as server-owned
    deployment truth and recheck them at authorization, execution, and retry.
20. Attribute local approvals to a configured server-side operator and generate
    approval IDs internally; do not accept human identity claims from browser JSON.
21. Treat `SUBMITTED` as reconciliation-only and preserve its original payment
    evidence across sanitized transient verification failures.
