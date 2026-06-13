// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title ICFAv1Forwarder (minimal)
/// @notice Subset of the Superfluid CFAv1Forwarder canonical at
///         0xcfA132E353cB4E398080B9700609bb008eceB125, used by StreamVaults to
///         drive flows on behalf of users that have granted ACL permissions.
/// @dev Function signatures match the ABI of the deployed forwarder; SuperToken
///      parameters are typed as `address` since interface types collapse to
///      `address` in the function selector.
interface ICFAv1Forwarder {
	/// @notice Returns the current flowrate from `sender` to `receiver` for `token`.
	function getFlowrate(
		address token,
		address sender,
		address receiver
	) external view returns (int96 flowrate);

	/// @notice Creates, updates, or deletes a flow on behalf of `sender`.
	/// @dev Requires the caller to have flow operator permissions granted by
	///      `sender` for `token` (see `grantPermissions`). Setting `flowrate = 0`
	///      deletes the flow.
	function setFlowrateFrom(
		address token,
		address sender,
		address receiver,
		int96 flowrate
	) external returns (bool);
}
