// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

library Types {
	/// @notice EIP-2612 permit signature components.
	/// @dev Packed into a struct to keep aggregator entrypoint signatures readable.
	struct Permit2612Sig {
		uint256 deadline;
		uint8 v;
		bytes32 r;
		bytes32 s;
	}

	/// @notice Trading rules set by the smart account owner.
	/// @param maxSlippageBps Maximum slippage tolerated, in basis points (1 = 0.01%).
	/// @param minTradeAmount Minimum amount of underlying input token required to execute a swap.
	/// @param settlementAddress Address that receives the swap output token after each trade.
	/// @param targetTokens Whitelist of acceptable output tokens (e.g. WETH, WBTC).
	struct UserRules {
		uint16 maxSlippageBps;
		uint256 minTradeAmount;
		address settlementAddress;
		address[] targetTokens;
	}

	/// @notice Parameters for a single swap executed by the bot through the smart account.
	/// @param superTokenIn SuperToken to downgrade to underlying before swapping. Use address(0) to skip downgrade.
	/// @param superAmountIn Amount of SuperToken to downgrade.
	/// @param tokenIn Underlying input token (used to set Permit2/router approvals).
	/// @param tokenOut Expected output token (must be in UserRules.targetTokens).
	/// @param target External call target (typically Uniswap Universal Router).
	/// @param value Native value to forward with the call (typically 0).
	/// @param data Encoded swap calldata returned by the Uniswap Trading API.
	/// @param minAmountOut Minimum amount of tokenOut delivered, enforced on the realized balance delta.
	struct SwapParams {
		address superTokenIn;
		uint256 superAmountIn;
		address tokenIn;
		address tokenOut;
		address target;
		uint256 value;
		bytes data;
		uint256 minAmountOut;
	}
}
