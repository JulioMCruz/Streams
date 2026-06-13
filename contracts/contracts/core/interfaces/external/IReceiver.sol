// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title IReceiver
/// @notice Minimal Chainlink CRE / Keystone report-receiver interface. A
///         DON-attested report is delivered on-chain by the KeystoneForwarder,
///         which (after verifying the report's signatures against the workflow
///         registry) invokes `onReport(metadata, report)` on the receiver.
/// @dev The forwarder probes ERC-165 `supportsInterface(type(IReceiver).interfaceId)`
///      before delivering, so receivers must advertise this interface.
interface IReceiver {
	/// @param metadata Forwarder-supplied workflow metadata (workflow id/owner, etc.).
	/// @param report   The DON-attested payload, opaque to the forwarder.
	function onReport(bytes calldata metadata, bytes calldata report) external;
}
