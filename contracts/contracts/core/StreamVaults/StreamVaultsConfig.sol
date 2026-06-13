// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// third party
/// openzeppelin
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

// local
/// interfaces
import {IStreamVaultsConfig} from "../interfaces/IStreamVaults/IStreamVaultsConfig.sol";
/// libraries
import {Errors} from "../libraries/Errors.sol";

/// @title StreamVaultsConfig
/// @notice Protocol-wide configuration: bot key, target whitelist, supported
///         swap tokens, smart account implementation, Permit2, and the
///         Superfluid CFAv1Forwarder address.
/// @dev UUPS upgradeable, owned by the protocol deployer.
contract StreamVaultsConfig is
	IStreamVaultsConfig,
	Initializable,
	OwnableUpgradeable,
	UUPSUpgradeable,
	Errors
{
	/// @notice Hard lower bound for the configurable accumulation window. Prevents
	///         setting an absurdly small window that would let dust streams pass
	///         the viability check in `StreamVaults.startStreamBot`.
	uint256 public constant MIN_ACCUMULATION_WINDOW = 60; // 1 minute

	/// =====================
	/// ====== Storage ======
	/// =====================

	address private _bot;
	address private _smartAccountImplementation;
	address private _permit2;
	address private _cfaForwarder;
	mapping(address => bool) private _allowedTargets;
	mapping(address => bool) private _supportedSwapTokens;

	/// @notice Minimum accumulation window (seconds) read by
	///         `StreamVaults.startStreamBot` to validate stream viability.
	uint256 private _minStreamAccumulationWindow;

	/// =====================
	/// ======== Init =======
	/// =====================

	/// @custom:oz-upgrades-unsafe-allow constructor
	constructor() {
		_disableInitializers();
	}

	function initialize(
		address owner_,
		address bot_,
		address smartAccountImpl_,
		address permit2_,
		address cfaForwarder_,
		uint256 minStreamAccumulationWindow_
	) external initializer {
		if (
			isZeroAddress(owner_) ||
			isZeroAddress(bot_) ||
			isZeroAddress(smartAccountImpl_) ||
			isZeroAddress(permit2_) ||
			isZeroAddress(cfaForwarder_)
		) revert INVALID_ADDRESS();

		if (minStreamAccumulationWindow_ < MIN_ACCUMULATION_WINDOW) {
			revert WINDOW_TOO_LOW();
		}

		__Ownable_init(owner_);

		_bot = bot_;
		_smartAccountImplementation = smartAccountImpl_;
		_permit2 = permit2_;
		_cfaForwarder = cfaForwarder_;
		_minStreamAccumulationWindow = minStreamAccumulationWindow_;

		emit BotUpdated(address(0), bot_);
		emit SmartAccountImplementationUpdated(address(0), smartAccountImpl_);
		emit Permit2Updated(address(0), permit2_);
		emit CfaForwarderUpdated(address(0), cfaForwarder_);
		emit MinStreamAccumulationWindowUpdated(0, minStreamAccumulationWindow_);
	}

	/// =====================
	/// ===== Setters =======
	/// =====================

	function setBot(address newBot) external onlyOwner {
		if (isZeroAddress(newBot)) revert INVALID_ADDRESS();
		address prev = _bot;
		_bot = newBot;
		emit BotUpdated(prev, newBot);
	}

	function setAllowedTarget(
		address target,
		bool allowed
	) external onlyOwner {
		if (isZeroAddress(target)) revert INVALID_ADDRESS();
		_allowedTargets[target] = allowed;
		emit TargetWhitelistUpdated(target, allowed);
	}

	function setSupportedSwapToken(
		address token,
		bool supported
	) external onlyOwner {
		if (isZeroAddress(token)) revert INVALID_ADDRESS();
		_supportedSwapTokens[token] = supported;
		emit SwapTokenSupportUpdated(token, supported);
	}

	function setSmartAccountImplementation(address newImpl) external onlyOwner {
		if (isZeroAddress(newImpl)) revert INVALID_ADDRESS();
		address prev = _smartAccountImplementation;
		_smartAccountImplementation = newImpl;
		emit SmartAccountImplementationUpdated(prev, newImpl);
	}

	function setPermit2(address newPermit2) external onlyOwner {
		if (isZeroAddress(newPermit2)) revert INVALID_ADDRESS();
		address prev = _permit2;
		_permit2 = newPermit2;
		emit Permit2Updated(prev, newPermit2);
	}

	function setCfaForwarder(address newForwarder) external onlyOwner {
		if (isZeroAddress(newForwarder)) revert INVALID_ADDRESS();
		address prev = _cfaForwarder;
		_cfaForwarder = newForwarder;
		emit CfaForwarderUpdated(prev, newForwarder);
	}

	function setMinStreamAccumulationWindow(
		uint256 windowSeconds
	) external onlyOwner {
		if (windowSeconds < MIN_ACCUMULATION_WINDOW) revert WINDOW_TOO_LOW();
		uint256 prev = _minStreamAccumulationWindow;
		_minStreamAccumulationWindow = windowSeconds;
		emit MinStreamAccumulationWindowUpdated(prev, windowSeconds);
	}

	/// =====================
	/// ======= Views =======
	/// =====================

	function bot() external view returns (address) {
		return _bot;
	}

	function isAllowedTarget(address target) external view returns (bool) {
		return _allowedTargets[target];
	}

	function isSupportedSwapToken(
		address token
	) external view returns (bool) {
		return _supportedSwapTokens[token];
	}

	function smartAccountImplementation() external view returns (address) {
		return _smartAccountImplementation;
	}

	function permit2() external view returns (address) {
		return _permit2;
	}

	function cfaForwarder() external view returns (address) {
		return _cfaForwarder;
	}

	function minStreamAccumulationWindow() external view returns (uint256) {
		return _minStreamAccumulationWindow;
	}

	/// =====================
	/// ====== Upgrade ======
	/// =====================

	function _authorizeUpgrade(
		address newImplementation
	) internal override onlyOwner {}
}
