# Verified Deployments

This registry records deployments that were checked against the target network.
It contains public onchain identifiers only.

## Arc Public Testnet

### AttestPayVault v1

| Field | Verified value |
| --- | --- |
| Deployment date | 2026-07-20 |
| Network | Arc Public Testnet |
| Chain ID | `5042002` |
| Vault | [`0x133936a0a57A2cc05c590CE06fD260514a466034`](https://testnet.arcscan.app/address/0x133936a0a57A2cc05c590CE06fD260514a466034) |
| Deployment transaction | [`0xa3740bc76416b06859d1f3d2ee6e70f5f656caa6ed9e2c3bf9ba479b791b85bf`](https://testnet.arcscan.app/tx/0xa3740bc76416b06859d1f3d2ee6e70f5f656caa6ed9e2c3bf9ba479b791b85bf) |
| Circle contract ID | `019f8073-4d16-7bb5-9ffc-0e97f672649e` |
| Administrator and executor | `0x669600e5812469C35d69643d68B2FA2e4163FF6D` |
| Authorizer | `0xF9763Ca6Bf08fcab7B9c3b8CbFDDBb50032978F2` |
| USDC interface | `0x3600000000000000000000000000000000000000` |
| Administrator-transfer delay | 86,400 seconds |
| Per-payment limit | 100 USDC |
| Daily limit | 500 USDC |
| Runtime bytecode | 8,800 bytes |

The deployment script independently read the runtime bytecode, asset address,
administrator, role assignments, and limits from Arc before recording the
deployment as verified.

### Verified vault lifecycle

On 2026-07-20, the deployed vault completed the controlled lifecycle below:

| Operation | Verified Arc evidence |
| --- | --- |
| Approve controlled recipient | [`0x24231e87c2917086c119eccb31b8c3bcebf8a607e819743df9793a40c0bf1265`](https://testnet.arcscan.app/tx/0x24231e87c2917086c119eccb31b8c3bcebf8a607e819743df9793a40c0bf1265), block `52811877` |
| Fund vault with 1 USDC | [`0xb27949439b36dd20bbbfd0d63334bd24f78c43f8df1756ebf80234d06adffc6c`](https://testnet.arcscan.app/tx/0xb27949439b36dd20bbbfd0d63334bd24f78c43f8df1756ebf80234d06adffc6c), block `52812514` |
| Execute policy-bound 0.01 USDC payment | [`0x0dbd814e6b6fb9502565b46e37f5e780d17f7f970f30f2f6bba4fa8fafb9c24a`](https://testnet.arcscan.app/tx/0x0dbd814e6b6fb9502565b46e37f5e780d17f7f970f30f2f6bba4fa8fafb9c24a), block `52813902` |

The payment receipt contained the ordered USDC `Transfer`, vault
`PaymentExecuted`, and Arc `Memo` events at log indexes 11, 12, and 13. A
subsequent independent read reported a 0.99 USDC vault balance, an approved
recipient, an unpaused vault, and 0.01 USDC spent for the current UTC day.

This is a testnet deployment. It is not approved for real assets.
