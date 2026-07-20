// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControlDefaultAdminRules} from
    "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @notice Holds treasury USDC and executes only signed, policy-compliant payments.
contract AttestPayVault is AccessControlDefaultAdminRules, EIP712, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    string public constant EIP712_NAME = "AttestPayVault";
    string public constant EIP712_VERSION = "1";

    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant AUTHORIZER_ROLE = keccak256("AUTHORIZER_ROLE");
    bytes32 public constant POLICY_MANAGER_ROLE = keccak256("POLICY_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    bytes32 public constant PAYMENT_AUTHORIZATION_TYPEHASH = keccak256(
        "PaymentAuthorization(bytes32 paymentId,address recipient,uint256 amount,bytes32 invoiceHash,bytes32 policyHash,uint48 validAfter,uint48 deadline,address authorizer)"
    );

    struct PaymentAuthorization {
        bytes32 paymentId;
        address recipient;
        uint256 amount;
        bytes32 invoiceHash;
        bytes32 policyHash;
        uint48 validAfter;
        uint48 deadline;
        address authorizer;
    }

    IERC20 public immutable usdc;
    uint256 public maxPaymentAmount;
    uint256 public dailyLimit;

    mapping(bytes32 paymentId => bool consumed) public usedPaymentIds;
    mapping(address recipient => bool approved) public approvedRecipients;
    mapping(uint256 unixDay => uint256 amount) public spentByDay;

    error ZeroAddress();
    error InvalidSpendingLimits(uint256 maxPaymentAmount, uint256 dailyLimit);
    error InvalidPaymentId();
    error InvalidEvidenceHash();
    error InvalidAuthorizationWindow(uint48 validAfter, uint48 deadline);
    error AuthorizationNotYetValid(uint48 validAfter);
    error AuthorizationExpired(uint48 deadline);
    error PaymentAlreadyUsed(bytes32 paymentId);
    error RecipientNotApproved(address recipient);
    error InvalidPaymentAmount(uint256 amount);
    error PaymentLimitExceeded(uint256 amount, uint256 limit);
    error DailyLimitExceeded(uint256 unixDay, uint256 attemptedTotal, uint256 limit);
    error InvalidAuthorizer(address authorizer);
    error InvalidAuthorizationSignature();

    event RecipientApprovalChanged(address indexed recipient, bool approved, address indexed changedBy);
    event SpendingLimitsChanged(
        uint256 maxPaymentAmount,
        uint256 dailyLimit,
        address indexed changedBy
    );
    event PaymentExecuted(
        bytes32 indexed paymentId,
        address indexed recipient,
        address indexed authorizer,
        uint256 amount,
        bytes32 invoiceHash,
        bytes32 policyHash,
        address executor,
        uint256 unixDay,
        uint256 spentToday
    );
    event EmergencyWithdrawal(address indexed recipient, uint256 amount, address indexed admin);

    constructor(
        address usdcAddress,
        address initialAdmin,
        address initialExecutor,
        address initialAuthorizer,
        uint48 adminTransferDelay,
        uint256 initialMaxPaymentAmount,
        uint256 initialDailyLimit
    )
        AccessControlDefaultAdminRules(adminTransferDelay, initialAdmin)
        EIP712(EIP712_NAME, EIP712_VERSION)
    {
        if (
            usdcAddress == address(0) || initialExecutor == address(0)
                || initialAuthorizer == address(0)
        ) {
            revert ZeroAddress();
        }

        _validateSpendingLimits(initialMaxPaymentAmount, initialDailyLimit);

        usdc = IERC20(usdcAddress);
        maxPaymentAmount = initialMaxPaymentAmount;
        dailyLimit = initialDailyLimit;

        _grantRole(EXECUTOR_ROLE, initialExecutor);
        _grantRole(AUTHORIZER_ROLE, initialAuthorizer);
        _grantRole(POLICY_MANAGER_ROLE, initialAdmin);
        _grantRole(PAUSER_ROLE, initialAdmin);
    }

    /// @notice Returns the EIP-712 digest that an authorizer must sign.
    function hashAuthorization(PaymentAuthorization calldata authorization)
        public
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                PAYMENT_AUTHORIZATION_TYPEHASH,
                authorization.paymentId,
                authorization.recipient,
                authorization.amount,
                authorization.invoiceHash,
                authorization.policyHash,
                authorization.validAfter,
                authorization.deadline,
                authorization.authorizer
            )
        );

        return _hashTypedDataV4(structHash);
    }

    /// @notice Consumes one signed authorization and transfers the exact approved USDC amount.
    function executePayment(PaymentAuthorization calldata authorization, bytes calldata signature)
        external
        onlyRole(EXECUTOR_ROLE)
        whenNotPaused
        nonReentrant
    {
        _validateAuthorization(authorization);

        bytes32 digest = hashAuthorization(authorization);
        if (!SignatureChecker.isValidSignatureNow(authorization.authorizer, digest, signature)) {
            revert InvalidAuthorizationSignature();
        }

        uint256 unixDay = block.timestamp / 1 days;
        uint256 updatedDailySpend = spentByDay[unixDay] + authorization.amount;
        if (updatedDailySpend > dailyLimit) {
            revert DailyLimitExceeded(unixDay, updatedDailySpend, dailyLimit);
        }

        // Consume the authorization before transferring assets. A failed transfer rolls back both writes.
        usedPaymentIds[authorization.paymentId] = true;
        spentByDay[unixDay] = updatedDailySpend;

        usdc.safeTransfer(authorization.recipient, authorization.amount);

        emit PaymentExecuted(
            authorization.paymentId,
            authorization.recipient,
            authorization.authorizer,
            authorization.amount,
            authorization.invoiceHash,
            authorization.policyHash,
            msg.sender,
            unixDay,
            updatedDailySpend
        );
    }

    function setRecipientApproval(address recipient, bool approved)
        external
        onlyRole(POLICY_MANAGER_ROLE)
    {
        if (recipient == address(0)) revert ZeroAddress();
        approvedRecipients[recipient] = approved;
        emit RecipientApprovalChanged(recipient, approved, msg.sender);
    }

    function setSpendingLimits(uint256 newMaxPaymentAmount, uint256 newDailyLimit)
        external
        onlyRole(POLICY_MANAGER_ROLE)
    {
        _validateSpendingLimits(newMaxPaymentAmount, newDailyLimit);
        maxPaymentAmount = newMaxPaymentAmount;
        dailyLimit = newDailyLimit;
        emit SpendingLimitsChanged(newMaxPaymentAmount, newDailyLimit, msg.sender);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /// @notice Allows the delayed-transfer admin to recover USDC only while execution is paused.
    function emergencyWithdraw(address recipient, uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        whenPaused
        nonReentrant
    {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidPaymentAmount(0);

        usdc.safeTransfer(recipient, amount);
        emit EmergencyWithdrawal(recipient, amount, msg.sender);
    }

    function _validateAuthorization(PaymentAuthorization calldata authorization) private view {
        if (authorization.paymentId == bytes32(0)) revert InvalidPaymentId();
        if (authorization.recipient == address(0)) revert ZeroAddress();
        if (authorization.invoiceHash == bytes32(0) || authorization.policyHash == bytes32(0)) {
            revert InvalidEvidenceHash();
        }
        if (authorization.validAfter > authorization.deadline) {
            revert InvalidAuthorizationWindow(authorization.validAfter, authorization.deadline);
        }
        if (block.timestamp < authorization.validAfter) {
            revert AuthorizationNotYetValid(authorization.validAfter);
        }
        if (block.timestamp > authorization.deadline) {
            revert AuthorizationExpired(authorization.deadline);
        }
        if (usedPaymentIds[authorization.paymentId]) {
            revert PaymentAlreadyUsed(authorization.paymentId);
        }
        if (!approvedRecipients[authorization.recipient]) {
            revert RecipientNotApproved(authorization.recipient);
        }
        if (authorization.amount == 0) revert InvalidPaymentAmount(0);
        if (authorization.amount > maxPaymentAmount) {
            revert PaymentLimitExceeded(authorization.amount, maxPaymentAmount);
        }
        if (
            authorization.authorizer == address(0)
                || !hasRole(AUTHORIZER_ROLE, authorization.authorizer)
        ) {
            revert InvalidAuthorizer(authorization.authorizer);
        }
    }

    function _validateSpendingLimits(uint256 paymentLimit, uint256 dayLimit) private pure {
        if (paymentLimit == 0 || dayLimit < paymentLimit) {
            revert InvalidSpendingLimits(paymentLimit, dayLimit);
        }
    }
}
