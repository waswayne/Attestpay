# AttestPay Architecture

This document records the intended system boundaries and dependency rules. It
describes the direction of the codebase; the current implementation remains at
the Circle and Arc integration-spike stage.

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

Given the same canonical vendor, work order, invoice, and policy version, the
policy engine must return the same decision. Policy-table tests will cover each
rule and precedence combination.

### Approval is bound to an exact action

Approval covers a canonical payload containing the recipient, amount, asset,
invoice hash, policy version, nonce, and expiry. Changing any bound field
invalidates the approval.

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
  integration spike. Application runtime state will move to migration-managed
  persistence when the database layer begins.
- Idempotency keys are durable application data. Payment idempotency records
  will be stored transactionally with payment attempts rather than generated
  transiently in a request handler.
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
