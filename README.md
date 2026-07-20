# AttestPay

> Every payment proves why it was allowed.

AttestPay is a policy-controlled treasury agent that evaluates invoices,
verified vendors, work orders, and spending rules before USDC can move. Routine
payments can execute automatically; duplicates, recipient changes, unusual
amounts, and policy violations are blocked or escalated for human approval.

The initial implementation uses a Circle developer-controlled wallet on
**Arc Public Testnet**.

> [!IMPORTANT]
> AttestPay is an early testnet prototype. It is not production-ready financial,
> custody, audit, or compliance infrastructure and must not be used with real
> funds.

## Why AttestPay

An AI system can extract facts from an invoice, but it should not have
unrestricted authority to move money. AttestPay separates those responsibilities:

- AI extracts and explains invoice information.
- Deterministic code evaluates payment policy.
- A human approves defined exceptions.
- An onchain vault enforces the final payment boundary.
- Every decision produces an authorization receipt linked to its Arc transaction.

The product is not another invoice OCR demo. Its core contribution is a
verifiable authorization boundary between an AI-proposed action and an
irreversible payment.

## Example Decision

Suppose a verified design contractor submits a 500 USDC invoice against an
approved work order:

1. AttestPay extracts the vendor, amount, invoice number, and wallet address.
2. The policy engine confirms the invoice is new, the work order matches, and
   the recipient is the vendor's verified wallet.
3. Because 500 USDC is inside the configured automatic-payment limit, the
   decision becomes `AUTO_APPROVED`.
4. AttestPay creates an authorization receipt and submits the payment through
   Circle on Arc Testnet.

If the same invoice is uploaded again, it becomes `BLOCKED_DUPLICATE`. If its
wallet address changes, it becomes `BLOCKED_RECIPIENT_MISMATCH`. If the amount
exceeds the automatic limit, it becomes `REVIEW_REQUIRED`.

This is similar to a company expense policy: software can prepare the payment,
but it cannot invent its own spending authority.

## Planned Architecture

The detailed dependency rules and module boundaries are recorded in
[docs/architecture.md](docs/architecture.md). Repository-wide implementation
requirements are defined in
[docs/engineering-standards.md](docs/engineering-standards.md).

```mermaid
flowchart LR
    A["Invoice upload"] --> B["Restricted extraction adapter"]
    B --> C["Schema and business validation"]
    C --> D["Deterministic policy engine"]
    D -->|Routine| E["Automatic authorization"]
    D -->|Exception| F["Human approval"]
    D -->|Violation| G["Blocked with reason"]
    E --> H["Signed authorization receipt"]
    F --> H
    H --> I["Circle developer-controlled EOA"]
    I --> J["Arc transaction memo"]
    J --> K["AttestPayVault"]
    K --> L["USDC recipient"]
    L --> M["Reconciliation and audit trail"]
```

### Why an EOA?

The prototype uses an externally owned account (EOA) because Arc transaction
memos require the EOA to be the direct caller. The memo links a payment to its
authorization receipt without putting the raw invoice or private vendor data
onchain.

## Current Build Status

**Milestone 0 — Technical spike: in progress**

| Capability | Status |
| --- | --- |
| Node.js project and Circle SDK | Complete |
| Strict TypeScript configuration and type-check command | Complete |
| Testnet API key and entity-secret registration workflow | Complete |
| Recovery-file generation and local safety checks | Complete |
| Circle wallet set and `ARC-TESTNET` EOA | Complete |
| Typed treasury port, Circle adapter, balance use case, and unit tests | Complete |
| Live Circle wallet and balance verification | Complete |
| Testnet funding and canonical USDC balance | Complete |
| Controlled recipient and idempotent USDC transfer path | Live verified |
| Independent Arc receipt and USDC event reconciliation | Complete |
| Arc memo encoding, Circle submission, and event reconciliation | Live verified |
| `AttestPayVault` contract, adversarial tests, and Arc deployment | Live verified |
| Vault recipient approval, funding, signed execution, and multi-event reconciliation | Implemented; live run next |
| Policy engine, API, database, and UI | Not started |

The immediate goal is to prove the critical external path before building the
full interface:

```text
Circle wallet -> Arc EOA -> transaction memo -> AttestPayVault -> test USDC recipient
```

The verified Arc Testnet contract address, deployment transaction, authorities,
and initial limits are recorded in [docs/deployments.md](docs/deployments.md).

## Repository Structure

```text
attestpay/
├── docs/
│   ├── architecture.md
│   └── engineering-standards.md
├── src/
│   ├── application/
│   │   ├── ports/
│   │   └── use-cases/
│   ├── config/
│   ├── infrastructure/
│   │   └── circle/
│   └── interfaces/
│       └── cli/
├── scripts/
│   └── circle/
│       ├── create-treasury-wallet.ts
│       ├── generate-entity-secret.ts
│       └── register-entity-secret.ts
├── .env.example
├── .gitattributes
├── .gitignore
├── package.json
├── tests/
│   └── unit/
├── tsconfig.json
└── README.md
```

The structure will expand as the wallet adapter, smart contract, policy engine,
web application, and tests are implemented.

## Local Setup

### Prerequisites

- Node.js 22.6 or newer
- npm
- TypeScript tooling is installed locally through the project
- A Circle Testnet server-side API key
- An encrypted location for the entity secret and recovery file

### Install

```bash
npm install
```

Create the local environment file:

```bash
cp .env.example .env.local
```

Generate an entity secret without printing it to the terminal:

```bash
npm run circle:generate-secret
```

Add the Testnet API key to `.env.local`:

```dotenv
CIRCLE_API_KEY=TEST_API_KEY:replace_with_your_key
CIRCLE_ENTITY_SECRET=generated_locally_by_the_previous_command
```

Register the entity secret once:

```bash
npm run circle:register-secret
```

The registration command validates the Testnet API key and entity-secret
format, refuses to overwrite existing recovery material, and verifies that
Circle produced one recovery file.

Do not repeat registration after it succeeds. Store the generated recovery
file outside the repository.

Create or verify the AttestPay Treasury wallet set and Arc Testnet EOA:

```bash
npm run circle:create-wallet
```

The command stores the returned wallet-set ID, wallet ID, and public wallet
address in `.env.local`. It persists Circle idempotency keys before making each
creation request, allowing the same operation to be retried safely after a
timeout without intentionally creating duplicate resources.

Create or verify a separate Circle-controlled Arc Testnet recipient:

```bash
npm run circle:create-recipient
```

Create or verify a separate Circle-controlled authorization signer. This wallet
signs EIP-712 payment instructions but cannot execute them:

```bash
npm run circle:create-authorizer
```

Compile, deploy, poll, and independently verify `AttestPayVault` on Arc Testnet:

```bash
npm run contract:deploy-vault
```

The deployment command uses Circle Contracts with the existing treasury EOA,
persists its idempotency key before submission, and verifies the deployed
bytecode, canonical Arc USDC address, role assignments, administrator, and
spending limits through an independent Arc RPC read.

Approve the controlled test recipient through the vault administrator:

```bash
npm run vault:approve-recipient -- approve-recipient-001
```

Fund the vault with a deliberately small amount of test USDC:

```bash
npm run vault:fund -- vault-funding-001 1
```

Create, sign, execute, and reconcile one vault-controlled test payment:

```bash
npm run vault:send-test -- vault-payment-001 0.01 invoice-001 policy-v1
```

The payment command persists one immutable authorization before submission.
The operation ID controls retries; the invoice and policy references are hashed
before they reach Arc. Settlement is accepted only when the receipt contains
the ordered `BeforeMemo -> Transfer -> PaymentExecuted -> Memo` evidence with
the exact expected vault, executor, authorizer, recipient, amount, and hashes.

Submit a deliberately small transfer by assigning it a stable operation ID:

```bash
npm run circle:send-test -- first-transfer 0.01
```

The command persists the exact payload and Circle idempotency key under the
ignored `local-state/` directory before submitting. Repeating the same command
resumes the same Circle transaction; reusing the operation ID with a different
amount or recipient fails closed. After Circle returns a transaction hash, the
command independently reads the Arc receipt and accepts settlement only when a
successful receipt contains the exact expected USDC sender, recipient, and
amount event.

Submit a small memo-linked transfer with separate operation and authorization
references:

```bash
npm run circle:send-memo-test -- memo-transfer-001 0.01 auth-001
```

The operation ID controls safe retries. The authorization reference identifies
the offchain approval record. AttestPay hashes the authorization reference into
a 32-byte `memoId`; it does not publish the invoice, vendor details, approval
notes, or other private business data. Settlement requires the ordered Arc
events `BeforeMemo -> Transfer -> Memo` to match the expected payment.

## Available Commands

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Run strict TypeScript validation without generating build files |
| `npm test` | Run unit tests through Node's test runner and `tsx` |
| `npm run test:contract` | Run Solidity authorization, replay, limit, pause, and fuzz tests |
| `npm run test:all` | Run TypeScript and Solidity test suites |
| `npm run contract:compile` | Compile the Solidity contracts with Hardhat |
| `npm run circle:generate-secret` | Generate an entity secret and store it in `.env.local` without printing it |
| `npm run circle:register-secret` | Register the entity secret with Circle and create recovery material |
| `npm run circle:create-wallet` | Create or verify the AttestPay wallet set and `ARC-TESTNET` EOA |
| `npm run circle:create-recipient` | Create or verify the controlled Arc Testnet recipient |
| `npm run circle:create-authorizer` | Create or verify the separate EIP-712 authorization signer |
| `npm run circle:balances` | Validate the configured treasury and list Circle-indexed balances |
| `npm run circle:send-test -- <operation-id> <amount>` | Submit or resume one idempotent controlled USDC transfer |
| `npm run circle:send-memo-test -- <operation-id> <amount> <authorization-reference>` | Submit, resume, and reconcile one memo-linked USDC transfer |
| `npm run vault:approve-recipient -- <operation-id>` | Approve and independently verify the controlled recipient through the vault |
| `npm run vault:status` | Read the live vault balance, pause state, recipient approval, limits, and daily spend from Arc |
| `npm run vault:fund -- <operation-id> <amount>` | Fund the vault and verify the exact canonical USDC transfer |
| `npm run vault:send-test -- <operation-id> <amount> <invoice-reference> <policy-reference>` | Sign, submit, and reconcile one policy-bound vault payment |
| `npm run contract:deploy-vault` | Compile, idempotently deploy, and independently verify `AttestPayVault` |

## Security Model

- Uploaded invoices and extracted model output are untrusted inputs.
- AI output cannot directly authorize or execute a payment.
- Vendor wallet addresses must be independently verified.
- Duplicate invoices and reused authorization receipts must be rejected.
- The vault, not the executor EOA, holds the budget protected by onchain policy.
- A separate authorizer signs the exact EIP-712 payment payload; the executor
  can submit that payload but cannot modify it.
- Human approval must bind to the exact recipient, amount, asset, invoice, and
  policy version.
- The onchain vault independently enforces recipient and spending constraints.
- Raw invoices, API keys, entity secrets, private keys, and recovery files must
  never be committed or placed onchain.

The repository ignores `.env.local`, `recovery/`, and `node_modules/`. The
committed `.env.example` contains variable names only.

## MVP Demo Scenarios

1. **Routine invoice:** passes every rule and pays automatically.
2. **Duplicate invoice:** is blocked before a transaction is created.
3. **Recipient substitution:** is blocked because the wallet differs from the
   verified vendor record.
4. **Unusual amount:** requires human approval bound to the exact payment.

## Delivery Roadmap

1. **Technical spike** — prove Circle wallet, Arc memo, vault, and test USDC
   compatibility.
2. **Decision core** — implement vendors, work orders, invoice hashing,
   deterministic policies, and authorization receipts.
3. **Controlled execution** — deploy the vault, add bound approvals, submit
   through Circle, and reconcile Arc events.
4. **Product workflow** — build the authenticated operator and approver UI.
5. **Product hardening** — adversarial tests, clean setup validation,
   documentation, and a repeatable product demo.

## Planned Technology

| Area | Language and technology |
| --- | --- |
| Web interface | TypeScript, Next.js, React, and Tailwind CSS |
| Backend and deterministic policy | Strict TypeScript with Zod validation |
| Circle wallet integration | TypeScript and the official Circle developer-controlled wallet SDK |
| Arc integration | TypeScript and `viem` |
| Onchain vault | Solidity, OpenZeppelin Contracts, and Hardhat 3 |
| Persistence | PostgreSQL with migration-managed SQL and an ORM |
| Browser verification | Playwright |

Circle and Arc are platforms rather than programming languages. TypeScript owns
the offchain system, Solidity owns the EVM contract, and SQL owns persistent
data definitions.

The Circle SDK and `viem` are installed and exercised by live integration
paths. Remaining technologies stay proposed until their implementation
milestone begins.

## Official References

- [Arc documentation](https://docs.arc.io/)
- [Arc transaction memos](https://docs.arc.io/arc/concepts/transaction-memos)
- [Circle developer-controlled wallets](https://developers.circle.com/wallets/dev-controlled)
- [Circle Wallets supported blockchains](https://developers.circle.com/wallets/supported-blockchains)
- [Circle custom contract deployment](https://developers.circle.com/contracts/scp-deploy-smart-contract)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/5.x/)
- [Hardhat 3 Solidity testing](https://hardhat.org/docs/guides/testing/using-solidity)

## License

No open-source license has been selected yet. All rights are reserved unless a
license file is added.
