// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

contract Errors {
	/// ======================
	/// ====== Generic =======
	/// ======================

	error INVALID_ADDRESS();
	error INVALID_AMOUNT();
	error INVALID_RATE();
	error RATE_TOO_LOW();
	error NO_STREAM_TO_CLOSE();
	error WINDOW_TOO_LOW();

	/// ======================
	/// ======= Auth =========
	/// ======================

	error NOT_BOT();
	error NOT_OWNER();
	error NOT_OPERATOR();
	error NOT_SMART_ACCOUNT_OWNER();
	error UNAUTHORIZED_CALLER();

	/// ==========================
	/// ====== StreamVaults ======
	/// ==========================

	error INVALID_TARGET();
	error INVALID_SWAP_TOKEN();
	error SMART_ACCOUNT_ALREADY_EXISTS();
	error SMART_ACCOUNT_NOT_FOUND();
	error SMART_ACCOUNT_IMPL_NOT_SET();
	error FORWARDER_NOT_SET();
	error UNSUPPORTED_UNDERLYING();
	error STREAM_NOT_ACTIVE();
	error STREAM_NOT_LOW();
	error INVALID_THRESHOLD();
	error INVALID_REPORT();

	/// ==========================
	/// ======== Registry ========
	/// ==========================

	error INVALID_LABEL();
	error LABEL_TAKEN();
	error LABEL_TOO_LONG();
	error INVALID_LABEL_CHARS();
	error NAME_NOT_FOUND();
	error NAME_ALREADY_REGISTERED();

	/// ==========================
	/// ====== SmartAccount ======
	/// ==========================

	error RULES_NOT_SET();
	error INVALID_RULES();
	error INSUFFICIENT_OUTPUT();
	error TARGET_TOKEN_NOT_ALLOWED();
	error TRADE_BELOW_MIN();
	error SWAP_CALL_FAILED();
	error SWAP_COOLDOWN_ACTIVE();

	function isZeroAddress(address _address) internal pure returns (bool) {
		return _address == address(0);
	}
}
