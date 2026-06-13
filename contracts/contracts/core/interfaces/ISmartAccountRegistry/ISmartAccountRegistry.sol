// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface ISmartAccountRegistry {
	/// =====================
	/// ====== Events =======
	/// =====================

	event NameRegistered(
		address indexed smartAccount,
		address indexed user,
		string label,
		bytes32 indexed labelHash
	);

	event NameReleased(
		address indexed smartAccount,
		string label,
		bytes32 indexed labelHash
	);

	event TextSet(
		bytes32 indexed labelHash,
		string indexed indexedKey,
		string key,
		string value
	);

	/// =====================
	/// ===== Mutating ======
	/// =====================

	/// @notice Registers `label` to point at `sa`. Caller must be the SA's owner.
	function register(address sa, string calldata label) external;

	/// @notice Releases the label currently bound to `sa`. Caller must be the SA's owner.
	function release(address sa) external;

	/// @notice Sets a free-form text record for `label`. Caller must be the SA's owner.
	function setText(
		string calldata label,
		string calldata key,
		string calldata value
	) external;

	/// =====================
	/// ======= Views =======
	/// =====================

	function smartAccountOf(string calldata label) external view returns (address);

	function labelOf(address sa) external view returns (string memory);

	function textOf(
		string calldata label,
		string calldata key
	) external view returns (string memory);
}
