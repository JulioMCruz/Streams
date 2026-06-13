// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title IExtendedResolver (ENSIP-10)
/// @notice Wildcard resolution interface. ENS resolvers that implement this
///         can serve every subname under a parent domain without per-subname
///         storage at the ENS registry level.
/// @dev https://docs.ens.domains/ensip/10
interface IExtendedResolver {
	/// @notice Resolves a name and inner request.
	/// @param name DNS-encoded ENS name (e.g. \x05alice\x0bstreamvault\x03eth\x00).
	/// @param data ABI-encoded inner call (e.g. `addr(bytes32)`, `text(bytes32,string)`).
	/// @return Result encoded the same way the inner function would have returned it.
	function resolve(
		bytes calldata name,
		bytes calldata data
	) external view returns (bytes memory);
}
