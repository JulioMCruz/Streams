// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Types} from "../../libraries/Types.sol";

interface IStreamVaults {
	/// =====================
	/// ====== Events =======
	/// =====================

	event SmartAccountCreated(
		address indexed user,
		address indexed smartAccount
	);

	/// @notice Emitted when a user replaces their smart account with a fresh
	///         clone on the current implementation (e.g. after an impl upgrade).
	event SmartAccountRedeployed(
		address indexed user,
		address indexed oldSmartAccount,
		address indexed newSmartAccount
	);

	/// @notice Emitted whenever a stream is opened, updated, or closed through the gateway.
	/// @dev `previousRate == 0 && newRate > 0` -> opened. `newRate == 0` -> closed.
	event StreamUpdated(
		address indexed user,
		address indexed smartAccount,
		address indexed superToken,
		int96 previousRate,
		int96 newRate
	);

	event SwapExecuted(
		address indexed smartAccount,
		address indexed target,
		address tokenIn,
		address tokenOut,
		uint256 amountIn,
		uint256 amountOut
	);

	/// @notice Emitted by `startStreamBot` when a user completes the one-shot setup.
	event StreamBotStarted(
		address indexed user,
		address indexed smartAccount,
		address indexed superToken,
		uint256 underlyingAmountWrapped,
		uint256 superAmountMinted,
		int96 rate
	);

	/// @notice Emitted when the owner changes the per-SA swap cooldown.
	event SwapCooldownUpdated(uint256 cooldownBlocks);

	/// @notice Emitted when the bot pre-emptively closes a user's stream because
	///         the sender's spendable balance fell near the Superfluid buffer.
	/// @dev Closing while still solvent returns the full deposit to the sender,
	///      avoiding the liquidation penalty. `availableBalance` is the sender's
	///      spendable balance (excludes the locked `deposit`) at close time.
	event StreamAutoClosed(
		address indexed user,
		address indexed smartAccount,
		address indexed superToken,
		int256 availableBalance,
		uint256 deposit
	);

	/// @notice Emitted when the owner changes the auto-close threshold.
	event StreamCloseThresholdUpdated(uint256 thresholdBps);

	/// @notice Emitted when a CRE/Keystone report is dispatched through
	///         `onReport`, carrying the selector of the action it ran
	///         (`executeSwap` or `closeStreamIfLow`).
	event ReportHandled(bytes4 indexed selector);

	/// =====================
	/// ======= User ========
	/// =====================

	/// @notice Deploys a SmartAccountDCA clone owned by `msg.sender`. One per user.
	function createSmartAccount() external returns (address smartAccount);

	/// @notice Replaces the caller's smart account with a fresh clone on the
	///         current implementation. Old clone is detached (not destroyed);
	///         caller must withdraw/close it first. Reverts if none exists.
	function redeploySmartAccount() external returns (address smartAccount);

	/// @notice Sets the flowrate of a stream from `msg.sender` to their smart account.
	/// @dev Requires the user to have granted ACL permissions to this contract on `superToken`
	///      (e.g. via `CFAv1Forwarder.grantPermissions`). Setting `rate = 0` closes the stream.
	function setStream(
		address smartAccount,
		address superToken,
		int96 rate
	) external;

	/// @notice One-shot setup: consumes an EIP-2612 permit to pull the underlying
	///         token, wraps it into the SuperToken for `msg.sender`, deploys +
	///         configures their SmartAccountDCA and opens the stream. Designed
	///         to be the second call of an EIP-5792 batch whose first call
	///         grants flow-operator permissions to this contract.
	function startStreamBot(
		address superToken,
		uint256 underlyingAmount,
		int96 rate,
		Types.UserRules calldata rules,
		Types.Permit2612Sig calldata permitSig
	) external returns (address smartAccount);

	/// =====================
	/// ======== Bot ========
	/// =====================

	/// @notice Forwards a validated swap request to the smart account. Bot-only.
	/// @dev Validates: msg.sender == config.bot, params.target is whitelisted,
	///      tokenIn/tokenOut are supported swap tokens. The smart account performs
	///      the actual call and slippage check.
	function executeSwap(
		address smartAccount,
		Types.SwapParams calldata params
	) external returns (uint256 amountOut);

	/// @notice Pre-emptively closes a user's stream when the sender's spendable
	///         balance has fallen to within `streamCloseThresholdBps` of the
	///         Superfluid buffer (i.e. the stream is about to go critical).
	///         Bot-only. Closing while solvent returns the full deposit to the
	///         user and avoids the liquidation penalty. Reverts if the stream is
	///         not active (`STREAM_NOT_ACTIVE`) or not yet low (`STREAM_NOT_LOW`).
	function closeStreamIfLow(
		address smartAccount,
		address superToken
	) external returns (bool closed);

	/// =====================
	/// ====== Owner ========
	/// =====================

	/// @notice Sets the per-SA swap cooldown in blocks. Owner-only.
	function setSwapCooldown(uint256 cooldownBlocks) external;

	/// @notice Sets the auto-close threshold in bps of the buffer. Owner-only.
	///         `closeStreamIfLow` fires when the sender's spendable balance is
	///         at or below `thresholdBps` of the locked deposit. Max 10000.
	function setStreamCloseThreshold(uint256 thresholdBps) external;

	/// =====================
	/// ======= Views =======
	/// =====================

	function smartAccountOf(address user) external view returns (address);

	function userOf(address smartAccount) external view returns (address);

	function config() external view returns (address);

	function swapCooldownBlocks() external view returns (uint256);

	function lastSwapBlock(address smartAccount) external view returns (uint256);

	function streamCloseThresholdBps() external view returns (uint256);
}
