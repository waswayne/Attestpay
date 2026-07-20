# AttestPayVault Security Model

This document defines the authority, invariants, failure behavior, and residual
risk of `AttestPayVault`. It describes the current implementation without
claiming that the contract has received an external audit.

## Protected Asset

The vault protects the configured ERC-20 asset. Arc Testnet deployment tooling
accepts only the canonical 6-decimal USDC interface at
`0x3600000000000000000000000000000000000000`.

Only USDC held by the vault is protected by its rules. USDC left in an executor
EOA remains directly spendable by that EOA and is outside the vault boundary.

## Authority Model

| Authority | Allowed actions | Explicit restrictions |
| --- | --- | --- |
| Default administrator | Manage roles, unpause, and recover funds while paused | One administrator; transfer is two-step and delayed |
| Policy manager | Approve or remove recipients and update spending limits | Cannot execute a payment or recover funds by this role alone |
| Authorizer | Sign one exact EIP-712 payment instruction | Cannot submit a vault transaction by this role alone |
| Executor | Submit a valid signed payment instruction | Cannot change signed fields, approve recipients, or change limits |
| Pauser | Stop normal payment execution | Cannot unpause or recover funds by this role alone |

The default administrator can grant and revoke the other roles. Administrator
compromise is therefore a critical risk and production administration should
use a separately secured multisignature or governance system.

## Payment Invariants

Every successful normal payment satisfies all of the following:

1. The caller currently has `EXECUTOR_ROLE`.
2. The vault is not paused.
3. The payment ID is nonzero and has never been consumed.
4. The recipient is nonzero and currently approved.
5. The amount is positive and no greater than the current per-payment limit.
6. The resulting spend for the current Unix UTC day is no greater than the
   current daily limit.
7. Invoice and policy hashes are nonzero.
8. The current block timestamp is inside the signed validity window.
9. The named authorizer currently has `AUTHORIZER_ROLE`.
10. The signature is valid for every authorization field, Arc's chain ID, and
    this vault address.
11. The authorization is consumed and daily spend is updated before USDC is
    transferred. A failed transfer reverts the entire state change.

## Replay And Modification Resistance

`paymentId` is consumed exactly once. EIP-712 domain separation prevents a
signature from being reused on another chain or vault. Changing the recipient,
amount, invoice hash, policy hash, validity window, payment ID, or authorizer
invalidates the signature.

Revoking an authorizer role invalidates that account's unexecuted signatures.
Removing a recipient or lowering a spending limit also takes effect before an
unexecuted authorization can settle.

## Emergency Path

Normal execution can be paused immediately by `PAUSER_ROLE`. Only the default
administrator can unpause. While paused, the default administrator can use
`emergencyWithdraw` to recover USDC without a payment authorization.

This recovery path prevents permanent loss during an incident but is also an
intentional policy bypass. Monitoring must alert on pause, role, limit,
recipient, administrator-transfer, and emergency-withdrawal events.

## Known Limitations

- The contract has automated tests but no independent external audit.
- Daily limits use fixed Unix UTC days, so spend capacity resets at a known
  boundary rather than over a rolling 24-hour window.
- Recipient approval is global; vendor-specific and work-order-specific caps
  remain offchain and are bound through the signed policy hash.
- Testnet administration and execution initially share one Circle treasury EOA.
- Testnet authorizer and executor wallets share one Circle entity credential,
  so their operational key-control domains are not independent yet.
- The contract is deliberately non-upgradeable. Changing its logic requires a
  new deployment and an explicit asset migration.

## Verification Coverage

Solidity tests cover valid execution, executor authorization, signer
authorization, payload modification, replay, recipient approval, validity
windows, per-payment limits, cumulative daily limits, pausing, emergency
recovery, and fuzzed valid payment amounts and IDs. TypeScript tests separately
cover Circle EIP-712 request mapping, signature verification, Arc Memo wrapping,
cross-vault replay resistance, current onchain readiness checks, exact contract
call submission, recipient-approval evidence, and ordered vault-payment event
reconciliation.
