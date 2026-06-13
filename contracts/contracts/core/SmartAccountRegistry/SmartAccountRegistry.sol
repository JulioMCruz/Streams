// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// third party
/// openzeppelin
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

// local
/// interfaces
import {IExtendedResolver} from "../interfaces/external/IExtendedResolver.sol";
import {ISmartAccountRegistry} from "../interfaces/ISmartAccountRegistry/ISmartAccountRegistry.sol";
import {IStreamVaults} from "../interfaces/IStreamVaults/IStreamVaults.sol";
/// libraries
import {Errors} from "../libraries/Errors.sol";

/// @title SmartAccountRegistry
/// @notice Maps human-readable labels to user-owned SmartAccountDCAs and
///         exposes them as ENS subnames via ENSIP-10 wildcard resolution.
/// @dev Registry is local to the protocol on Base Sepolia. To wire it into
///      ENS proper, point a parent name's resolver at this contract (directly
///      on the same chain, or through a CCIP-Read / Durin gateway when ENS
///      lives on a different chain).
contract SmartAccountRegistry is
	ISmartAccountRegistry,
	IExtendedResolver,
	Errors
{
	/// =====================
	/// ====== Storage ======
	/// =====================

	IStreamVaults public immutable streamVaults;

	mapping(bytes32 => address) private _smartAccountByLabelHash;
	mapping(address => string) private _labelOf;
	mapping(bytes32 => mapping(string => string)) private _text;

	/// =====================
	/// ==== ENS selectors ===
	/// =====================

	bytes4 private constant SEL_ADDR = 0x3b3b57de; // addr(bytes32)
	bytes4 private constant SEL_ADDR_MULTICOIN = 0xf1cb7e06; // addr(bytes32,uint256)
	bytes4 private constant SEL_TEXT = 0x59d1d43c; // text(bytes32,string)

	bytes4 private constant INTERFACE_ID_ENSIP10 = 0x9061b923;
	bytes4 private constant INTERFACE_ID_ERC165 = 0x01ffc9a7;

	uint256 private constant COIN_TYPE_ETH = 60;

	/// =====================
	/// ======== Init =======
	/// =====================

	constructor(address streamVaults_) {
		if (isZeroAddress(streamVaults_)) revert INVALID_ADDRESS();
		streamVaults = IStreamVaults(streamVaults_);
	}

	/// =====================
	/// ===== Mutating ======
	/// =====================

	/// @dev E-03: maximum DNS-safe label length (RFC 1035 §2.3.4).
	uint256 private constant MAX_LABEL_LENGTH = 63;

	function register(address sa, string calldata label) external {
		bytes memory raw = bytes(label);
		if (raw.length == 0) revert INVALID_LABEL();
		// E-03: enforce DNS-safe label: max 63 chars, only [a-z0-9-] allowed.
		if (raw.length > MAX_LABEL_LENGTH) revert LABEL_TOO_LONG();
		_validateLabelChars(raw);
		if (streamVaults.userOf(sa) != msg.sender) revert NOT_SMART_ACCOUNT_OWNER();
		if (bytes(_labelOf[sa]).length != 0) revert NAME_ALREADY_REGISTERED();

		bytes32 labelHash = keccak256(raw);
		if (_smartAccountByLabelHash[labelHash] != address(0)) revert LABEL_TAKEN();

		_smartAccountByLabelHash[labelHash] = sa;
		_labelOf[sa] = label;

		emit NameRegistered(sa, msg.sender, label, labelHash);
	}

	function release(address sa) external {
		if (streamVaults.userOf(sa) != msg.sender) revert NOT_SMART_ACCOUNT_OWNER();

		string memory label = _labelOf[sa];
		if (bytes(label).length == 0) revert NAME_NOT_FOUND();

		bytes32 labelHash = keccak256(bytes(label));
		delete _smartAccountByLabelHash[labelHash];
		delete _labelOf[sa];

		emit NameReleased(sa, label, labelHash);
	}

	function setText(
		string calldata label,
		string calldata key,
		string calldata value
	) external {
		bytes32 labelHash = keccak256(bytes(label));
		address sa = _smartAccountByLabelHash[labelHash];
		if (sa == address(0)) revert NAME_NOT_FOUND();
		if (streamVaults.userOf(sa) != msg.sender) revert NOT_SMART_ACCOUNT_OWNER();

		_text[labelHash][key] = value;
		emit TextSet(labelHash, key, key, value);
	}

	/// =====================
	/// ======= Views =======
	/// =====================

	function smartAccountOf(
		string calldata label
	) external view returns (address) {
		return _smartAccountByLabelHash[keccak256(bytes(label))];
	}

	function labelOf(address sa) external view returns (string memory) {
		return _labelOf[sa];
	}

	function textOf(
		string calldata label,
		string calldata key
	) external view returns (string memory) {
		bytes32 labelHash = keccak256(bytes(label));
		address sa = _smartAccountByLabelHash[labelHash];
		return _resolveText(labelHash, sa, key);
	}

	/// ==========================
	/// ====== ENSIP-10 ==========
	/// ==========================

	/// @inheritdoc IExtendedResolver
	function resolve(
		bytes calldata name,
		bytes calldata data
	) external view returns (bytes memory) {
		string memory label = _firstLabel(name);
		bytes32 labelHash = keccak256(bytes(label));
		address sa = _smartAccountByLabelHash[labelHash];

		bytes4 selector = bytes4(data[:4]);

		if (selector == SEL_ADDR) {
			return abi.encode(sa);
		}

		if (selector == SEL_ADDR_MULTICOIN) {
			(, uint256 coinType) = abi.decode(data[4:], (bytes32, uint256));
			if (coinType == COIN_TYPE_ETH) {
				return abi.encode(abi.encodePacked(sa));
			}
			return abi.encode(new bytes(0));
		}

		if (selector == SEL_TEXT) {
			(, string memory key) = abi.decode(data[4:], (bytes32, string));
			return abi.encode(_resolveText(labelHash, sa, key));
		}

		return new bytes(0);
	}

	function supportsInterface(bytes4 interfaceID) external pure returns (bool) {
		return
			interfaceID == INTERFACE_ID_ENSIP10 ||
			interfaceID == INTERFACE_ID_ERC165;
	}

	/// =====================
	/// ====== Internal =====
	/// =====================

	/// @dev E-03: reverts if any byte is outside [a-z0-9-] (DNS-safe charset).
	function _validateLabelChars(bytes memory raw) internal pure {
		for (uint256 i; i < raw.length; ++i) {
			uint8 c = uint8(raw[i]);
			bool isLower = c >= 0x61 && c <= 0x7a; // a-z
			bool isDigit = c >= 0x30 && c <= 0x39; // 0-9
			bool isHyphen = c == 0x2d; // -
			if (!isLower && !isDigit && !isHyphen) revert INVALID_LABEL_CHARS();
		}
	}

	/// @dev Extracts the leftmost label from a DNS-encoded ENS name. Empty
	///      string for malformed input — resolution then returns the zero
	///      address, which is the standard "not found" semantics in ENS.
	function _firstLabel(
		bytes calldata name
	) internal pure returns (string memory) {
		if (name.length == 0) return "";
		uint8 len = uint8(name[0]);
		if (len == 0 || uint256(len) + 1 > name.length) return "";
		return string(name[1:1 + len]);
	}

	/// @dev Auto-generates `streamvaults:*` records by reading on-chain state.
	///      Falls back to the user-set free-form text record otherwise.
	function _resolveText(
		bytes32 labelHash,
		address sa,
		string memory key
	) internal view returns (string memory) {
		if (sa != address(0)) {
			bytes32 keyHash = keccak256(bytes(key));
			if (keyHash == keccak256("streamvaults:smart-account")) {
				return Strings.toHexString(uint160(sa), 20);
			}
			if (keyHash == keccak256("streamvaults:owner")) {
				return Strings.toHexString(uint160(streamVaults.userOf(sa)), 20);
			}
			if (keyHash == keccak256("streamvaults:operator")) {
				return Strings.toHexString(uint160(address(streamVaults)), 20);
			}
		}
		return _text[labelHash][key];
	}
}
