// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title MockPermit2
/// @notice Minimal Permit2 stub for tests. Records the last `approve` call per
///         (owner, token, spender) so specs can assert SmartAccountDCA grants
///         the Universal Router a Permit2 allowance before swapping (and revokes
///         it after). Does NOT move funds — the mock router pulls tokenIn via a
///         plain ERC20 allowance in tests.
contract MockPermit2 {
	struct Allowance {
		uint160 amount;
		uint48 expiration;
		uint48 nonce;
	}

	/// @dev owner => token => spender => allowance
	mapping(address => mapping(address => mapping(address => Allowance)))
		private _allowance;

	/// @notice Number of times `approve` was called — handy for swap-flow assertions.
	uint256 public approveCalls;

	function approve(
		address token,
		address spender,
		uint160 amount,
		uint48 expiration
	) external {
		Allowance storage a = _allowance[msg.sender][token][spender];
		a.amount = amount;
		a.expiration = expiration;
		approveCalls += 1;
	}

	function allowance(
		address owner,
		address token,
		address spender
	) external view returns (uint160 amount, uint48 expiration, uint48 nonce) {
		Allowance storage a = _allowance[owner][token][spender];
		return (a.amount, a.expiration, a.nonce);
	}
}
