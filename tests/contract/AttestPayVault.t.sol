// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AttestPayVault} from "../../contracts/AttestPayVault.sol";
import {MockUSDC} from "../../contracts/test/MockUSDC.sol";

contract AttestPayVaultTest is Test {
    uint256 private constant USDC = 1e6;
    uint256 private constant AUTHORIZER_KEY = 0xA11CE;

    address private constant EXECUTOR = address(0xE1);
    address private constant RECIPIENT = address(0xB0B);
    address private constant OUTSIDER = address(0xBAD);

    MockUSDC private token;
    AttestPayVault private vault;
    address private authorizer;

    function setUp() public {
        authorizer = vm.addr(AUTHORIZER_KEY);
        token = new MockUSDC();
        vault = new AttestPayVault(
            address(token),
            address(this),
            EXECUTOR,
            authorizer,
            2 days,
            100 * USDC,
            200 * USDC
        );

        vault.setRecipientApproval(RECIPIENT, true);
        token.mint(address(vault), 1_000 * USDC);
    }

    function testExecutesExactAuthorizedPayment() public {
        AttestPayVault.PaymentAuthorization memory authorization =
            _authorization(keccak256("payment-001"), 25 * USDC);
        bytes memory signature = _sign(authorization, AUTHORIZER_KEY);

        vm.prank(EXECUTOR);
        vault.executePayment(authorization, signature);

        assertEq(token.balanceOf(RECIPIENT), 25 * USDC);
        assertEq(token.balanceOf(address(vault)), 975 * USDC);
        assertTrue(vault.usedPaymentIds(authorization.paymentId));
        assertEq(vault.spentByDay(block.timestamp / 1 days), 25 * USDC);
    }

    function testRejectsUnauthorizedExecutor() public {
        AttestPayVault.PaymentAuthorization memory authorization =
            _authorization(keccak256("payment-002"), 10 * USDC);
        bytes memory signature = _sign(authorization, AUTHORIZER_KEY);

        vm.expectRevert();
        vm.prank(OUTSIDER);
        vault.executePayment(authorization, signature);
    }

    function testRejectsReplayedPaymentId() public {
        AttestPayVault.PaymentAuthorization memory authorization =
            _authorization(keccak256("payment-003"), 10 * USDC);
        bytes memory signature = _sign(authorization, AUTHORIZER_KEY);

        vm.startPrank(EXECUTOR);
        vault.executePayment(authorization, signature);
        vm.expectRevert(
            abi.encodeWithSelector(
                AttestPayVault.PaymentAlreadyUsed.selector, authorization.paymentId
            )
        );
        vault.executePayment(authorization, signature);
        vm.stopPrank();
    }

    function testRejectsTamperedAmount() public {
        AttestPayVault.PaymentAuthorization memory authorization =
            _authorization(keccak256("payment-004"), 10 * USDC);
        bytes memory signature = _sign(authorization, AUTHORIZER_KEY);
        authorization.amount = 11 * USDC;

        vm.prank(EXECUTOR);
        vm.expectRevert(AttestPayVault.InvalidAuthorizationSignature.selector);
        vault.executePayment(authorization, signature);
    }

    function testRejectsUnapprovedRecipient() public {
        AttestPayVault.PaymentAuthorization memory authorization =
            _authorization(keccak256("payment-005"), 10 * USDC);
        authorization.recipient = OUTSIDER;
        bytes memory signature = _sign(authorization, AUTHORIZER_KEY);

        vm.expectRevert(
            abi.encodeWithSelector(AttestPayVault.RecipientNotApproved.selector, OUTSIDER)
        );
        vm.prank(EXECUTOR);
        vault.executePayment(authorization, signature);
    }

    function testRejectsExpiredAuthorization() public {
        vm.warp(10 days);
        AttestPayVault.PaymentAuthorization memory authorization =
            _authorization(keccak256("payment-006"), 10 * USDC);
        authorization.validAfter = uint48(block.timestamp - 2);
        authorization.deadline = uint48(block.timestamp - 1);
        bytes memory signature = _sign(authorization, AUTHORIZER_KEY);

        vm.expectRevert(
            abi.encodeWithSelector(
                AttestPayVault.AuthorizationExpired.selector, authorization.deadline
            )
        );
        vm.prank(EXECUTOR);
        vault.executePayment(authorization, signature);
    }

    function testRejectsAuthorizationBeforeValidTime() public {
        AttestPayVault.PaymentAuthorization memory authorization =
            _authorization(keccak256("payment-007"), 10 * USDC);
        authorization.validAfter = uint48(block.timestamp + 1 hours);
        bytes memory signature = _sign(authorization, AUTHORIZER_KEY);

        vm.expectRevert(
            abi.encodeWithSelector(
                AttestPayVault.AuthorizationNotYetValid.selector, authorization.validAfter
            )
        );
        vm.prank(EXECUTOR);
        vault.executePayment(authorization, signature);
    }

    function testEnforcesPerPaymentLimit() public {
        AttestPayVault.PaymentAuthorization memory authorization =
            _authorization(keccak256("payment-008"), 101 * USDC);
        bytes memory signature = _sign(authorization, AUTHORIZER_KEY);

        vm.expectRevert(
            abi.encodeWithSelector(
                AttestPayVault.PaymentLimitExceeded.selector, 101 * USDC, 100 * USDC
            )
        );
        vm.prank(EXECUTOR);
        vault.executePayment(authorization, signature);
    }

    function testEnforcesDailyLimitAcrossPayments() public {
        AttestPayVault.PaymentAuthorization memory first =
            _authorization(keccak256("payment-009-a"), 100 * USDC);
        AttestPayVault.PaymentAuthorization memory second =
            _authorization(keccak256("payment-009-b"), 100 * USDC);
        AttestPayVault.PaymentAuthorization memory third =
            _authorization(keccak256("payment-009-c"), 1);
        bytes memory firstSignature = _sign(first, AUTHORIZER_KEY);
        bytes memory secondSignature = _sign(second, AUTHORIZER_KEY);
        bytes memory thirdSignature = _sign(third, AUTHORIZER_KEY);

        vm.startPrank(EXECUTOR);
        vault.executePayment(first, firstSignature);
        vault.executePayment(second, secondSignature);
        vm.expectRevert(
            abi.encodeWithSelector(
                AttestPayVault.DailyLimitExceeded.selector,
                block.timestamp / 1 days,
                200 * USDC + 1,
                200 * USDC
            )
        );
        vault.executePayment(third, thirdSignature);
        vm.stopPrank();
    }

    function testPauseBlocksPaymentsAndEnablesRecovery() public {
        vault.pause();
        AttestPayVault.PaymentAuthorization memory authorization =
            _authorization(keccak256("payment-010"), 10 * USDC);
        bytes memory signature = _sign(authorization, AUTHORIZER_KEY);

        vm.expectRevert();
        vm.prank(EXECUTOR);
        vault.executePayment(authorization, signature);

        vault.emergencyWithdraw(RECIPIENT, 5 * USDC);
        assertEq(token.balanceOf(RECIPIENT), 5 * USDC);
    }

    function testRejectsSignatureFromAccountWithoutAuthorizerRole() public {
        uint256 untrustedKey = 0xB0B;
        AttestPayVault.PaymentAuthorization memory authorization =
            _authorization(keccak256("payment-011"), 10 * USDC);
        authorization.authorizer = vm.addr(untrustedKey);
        bytes memory signature = _sign(authorization, untrustedKey);

        vm.expectRevert(
            abi.encodeWithSelector(
                AttestPayVault.InvalidAuthorizer.selector, authorization.authorizer
            )
        );
        vm.prank(EXECUTOR);
        vault.executePayment(authorization, signature);
    }

    function testFuzzExecutesBoundedPayment(uint96 rawAmount, bytes32 paymentId) public {
        uint256 amount = bound(uint256(rawAmount), 1, 100 * USDC);
        paymentId = bytes32(bound(uint256(paymentId), 1, type(uint256).max));
        AttestPayVault.PaymentAuthorization memory authorization =
            _authorization(paymentId, amount);
        bytes memory signature = _sign(authorization, AUTHORIZER_KEY);

        vm.prank(EXECUTOR);
        vault.executePayment(authorization, signature);

        assertEq(token.balanceOf(RECIPIENT), amount);
        assertEq(vault.spentByDay(block.timestamp / 1 days), amount);
    }

    function testRejectsInvalidConstructorConfiguration() public {
        vm.expectRevert(AttestPayVault.ZeroAddress.selector);
        new AttestPayVault(
            address(0),
            address(this),
            EXECUTOR,
            authorizer,
            2 days,
            100 * USDC,
            200 * USDC
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                AttestPayVault.InvalidSpendingLimits.selector, 100 * USDC, 99 * USDC
            )
        );
        new AttestPayVault(
            address(token),
            address(this),
            EXECUTOR,
            authorizer,
            2 days,
            100 * USDC,
            99 * USDC
        );
    }

    function testPolicyManagerUpdatesRecipientsAndLimits() public {
        vault.setRecipientApproval(RECIPIENT, false);
        assertFalse(vault.approvedRecipients(RECIPIENT));

        vault.setSpendingLimits(50 * USDC, 300 * USDC);
        assertEq(vault.maxPaymentAmount(), 50 * USDC);
        assertEq(vault.dailyLimit(), 300 * USDC);

        vm.expectRevert(AttestPayVault.ZeroAddress.selector);
        vault.setRecipientApproval(address(0), true);

        vm.expectRevert(
            abi.encodeWithSelector(
                AttestPayVault.InvalidSpendingLimits.selector, 0, 300 * USDC
            )
        );
        vault.setSpendingLimits(0, 300 * USDC);
    }

    function testAdminUnpausesAndValidatesEmergencyRecovery() public {
        vault.pause();

        vm.expectRevert(AttestPayVault.ZeroAddress.selector);
        vault.emergencyWithdraw(address(0), USDC);

        vm.expectRevert(
            abi.encodeWithSelector(AttestPayVault.InvalidPaymentAmount.selector, 0)
        );
        vault.emergencyWithdraw(RECIPIENT, 0);

        vault.unpause();
        assertFalse(vault.paused());
    }

    function testRejectsMalformedAuthorizationFields() public {
        AttestPayVault.PaymentAuthorization memory malformed =
            _authorization(bytes32(0), 10 * USDC);
        _expectExecutorRevert(
            abi.encodeWithSelector(AttestPayVault.InvalidPaymentId.selector), malformed
        );

        malformed = _authorization(keccak256("malformed-recipient"), 10 * USDC);
        malformed.recipient = address(0);
        _expectExecutorRevert(
            abi.encodeWithSelector(AttestPayVault.ZeroAddress.selector), malformed
        );

        malformed = _authorization(keccak256("malformed-evidence"), 10 * USDC);
        malformed.invoiceHash = bytes32(0);
        _expectExecutorRevert(
            abi.encodeWithSelector(AttestPayVault.InvalidEvidenceHash.selector), malformed
        );

        malformed = _authorization(keccak256("malformed-window"), 10 * USDC);
        malformed.validAfter = uint48(block.timestamp + 2 hours);
        malformed.deadline = uint48(block.timestamp + 1 hours);
        _expectExecutorRevert(
            abi.encodeWithSelector(
                AttestPayVault.InvalidAuthorizationWindow.selector,
                malformed.validAfter,
                malformed.deadline
            ),
            malformed
        );

        malformed = _authorization(keccak256("malformed-amount"), 0);
        _expectExecutorRevert(
            abi.encodeWithSelector(AttestPayVault.InvalidPaymentAmount.selector, 0),
            malformed
        );
    }

    function _authorization(bytes32 paymentId, uint256 amount)
        private
        view
        returns (AttestPayVault.PaymentAuthorization memory)
    {
        return AttestPayVault.PaymentAuthorization({
            paymentId: paymentId,
            recipient: RECIPIENT,
            amount: amount,
            invoiceHash: keccak256("invoice-001"),
            policyHash: keccak256("policy-v1"),
            validAfter: uint48(block.timestamp),
            deadline: uint48(block.timestamp + 1 hours),
            authorizer: authorizer
        });
    }

    function _sign(AttestPayVault.PaymentAuthorization memory authorization, uint256 key)
        private
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, vault.hashAuthorization(authorization));
        return abi.encodePacked(r, s, v);
    }

    function _expectExecutorRevert(
        bytes memory expectedError,
        AttestPayVault.PaymentAuthorization memory authorization
    ) private {
        vm.expectRevert(expectedError);
        vm.prank(EXECUTOR);
        vault.executePayment(authorization, "");
    }
}
