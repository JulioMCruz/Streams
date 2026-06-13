// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title IPermit2 (minimal AllowanceTransfer subset)
/// @notice Subset of Uniswap's canonical Permit2 (0x000000000022D473030F116dDEE9F6B43aC78BA3).
///         The Universal Router pulls ERC20s through Permit2, so a token holder
///         must (1) ERC20-approve Permit2 AND (2) call `approve` here to authorize
///         the router as a Permit2 spender. Missing (2) makes the router's pull
///         revert (surfaces as SWAP_CALL_FAILED upstream).
interface IPermit2 {
	/// @notice Approves `spender` to pull up to `amount` of `token` via Permit2
	///         until `expiration`.
	function approve(
		address token,
		address spender,
		uint160 amount,
		uint48 expiration
	) external;

	/// @notice Current Permit2 allowance granted by `owner` to `spender` for `token`.
	function allowance(
		address owner,
		address token,
		address spender
	) external view returns (uint160 amount, uint48 expiration, uint48 nonce);
}
