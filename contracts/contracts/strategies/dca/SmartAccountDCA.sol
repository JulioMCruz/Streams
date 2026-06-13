// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// third party
/// openzeppelin
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
/// superfluid
import {ISuperToken} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperToken.sol";

// local
/// interfaces
import {ISmartAccountDCA} from "./interfaces/ISmartAccountDCA.sol";
import {IStreamVaults} from "../../core/interfaces/IStreamVaults/IStreamVaults.sol";
import {IStreamVaultsConfig} from "../../core/interfaces/IStreamVaults/IStreamVaultsConfig.sol";
import {IPermit2} from "../../core/interfaces/external/IPermit2.sol";
/// libraries
import {Errors} from "../../core/libraries/Errors.sol";
import {Types} from "../../core/libraries/Types.sol";

/// @title SmartAccountDCA
/// @notice Per-user smart account that holds streamed funds and executes
///         user-bounded DCA swaps requested by the StreamVaults gateway.
/// @dev Deployed as an EIP-1167 minimal proxy by StreamVaults. The implementation
///      is initializer-protected; clones call `initialize` once.
contract SmartAccountDCA is
	ISmartAccountDCA,
	Initializable,
	ReentrancyGuard,
	Errors
{
	using SafeERC20 for IERC20;

	/// =====================
	/// ====== Storage ======
	/// =====================

	address private _owner;
	address private _operator;
	bool private _rulesSet;
	uint16 private _maxSlippageBps;
	uint256 private _minTradeAmount;
	address private _settlementAddress;
	address[] private _targetTokens;
	mapping(address => bool) private _isTargetToken;

	/// @dev Hard cap on user-configured slippage (50%). Above this we treat the
	///      rules as a misconfiguration.
	uint16 private constant MAX_SLIPPAGE_BPS = 5_000;

	/// =====================
	/// ===== Modifiers =====
	/// =====================

	modifier onlyOwner() {
		if (msg.sender != _owner) revert NOT_OWNER();
		_;
	}

	modifier onlyOperator() {
		if (msg.sender != _operator) revert NOT_OPERATOR();
		_;
	}

	/// =====================
	/// ======== Init =======
	/// =====================

	/// @custom:oz-upgrades-unsafe-allow constructor
	constructor() {
		_disableInitializers();
	}

	function initialize(
		address owner_,
		address operator_
	) external initializer {
		_initOwnerOperator(owner_, operator_);
	}

	/// @notice One-shot initializer that sets owner, operator and trading rules
	///         in a single tx. Used by the StreamVaults aggregator entrypoint.
	function initializeWithRules(
		address owner_,
		address operator_,
		Types.UserRules calldata rules_
	) external initializer {
		_initOwnerOperator(owner_, operator_);
		_setRules(rules_);
	}

	/// =====================
	/// ======= Owner =======
	/// =====================

	function setRules(Types.UserRules calldata rules_) external onlyOwner {
		_setRules(rules_);
	}

	function withdraw(
		address token,
		uint256 amount,
		address to
	) external onlyOwner nonReentrant {
		if (isZeroAddress(to)) revert INVALID_ADDRESS();
		IERC20(token).safeTransfer(to, amount);
		emit Withdrawn(token, to, amount);
	}

	function withdrawAll(
		address token,
		address to
	) external onlyOwner nonReentrant {
		if (isZeroAddress(to)) revert INVALID_ADDRESS();
		uint256 bal = IERC20(token).balanceOf(address(this));
		if (bal == 0) return;
		IERC20(token).safeTransfer(to, bal);
		emit Withdrawn(token, to, bal);
	}

	/// =====================
	/// ====== Operator =====
	/// =====================

	function executeSwap(
		Types.SwapParams calldata params
	) external onlyOperator nonReentrant returns (uint256 amountOut) {
		if (!_rulesSet) revert RULES_NOT_SET();
		if (!_isTargetToken[params.tokenOut]) revert TARGET_TOKEN_NOT_ALLOWED();
		if (isZeroAddress(params.tokenIn)) revert INVALID_ADDRESS();

		// 1. Optionally downgrade SuperToken to underlying.
		if (
			!isZeroAddress(params.superTokenIn) && params.superAmountIn > 0
		) {
			ISuperToken(params.superTokenIn).downgrade(params.superAmountIn);
		}

		IERC20 tokenIn = IERC20(params.tokenIn);
		IERC20 tokenOut = IERC20(params.tokenOut);

		// 2. Sanity: trade size meets user-configured minimum.
		uint256 inBefore = tokenIn.balanceOf(address(this));
		if (inBefore < _minTradeAmount) revert TRADE_BELOW_MIN();

		// 3. Exact-amount approvals: approve only what is needed for this swap.
		//    E-02: using inBefore (full current balance as a safe upper bound for
		//    the approval avoids the need for a router to pre-quote the exact pull,
		//    while still bounding the exposure to at most the current balance).
		//    Permit2 approval is also bounded to inBefore.
		address permit2 = _ensureApprovals(params.tokenIn, params.target, inBefore);

		// 4. Snapshot output, execute swap, measure realized delta.
		uint256 outBefore = tokenOut.balanceOf(address(this));
		(bool ok, ) = params.target.call{value: params.value}(params.data);
		if (!ok) revert SWAP_CALL_FAILED();

		// E-02: revoke leftover approvals after the swap call completes — both
		// the plain ERC20 allowance and the Permit2 spender authorization.
		tokenIn.forceApprove(params.target, 0);
		if (!isZeroAddress(permit2)) {
			IPermit2(permit2).approve(params.tokenIn, params.target, 0, 0);
		}

		uint256 outAfter = tokenOut.balanceOf(address(this));
		amountOut = outAfter - outBefore;

		// 5. Defense-in-depth slippage check on the actual delta.
		if (amountOut < params.minAmountOut) revert INSUFFICIENT_OUTPUT();

		// 6. Forward output to the user's settlement address.
		if (amountOut > 0) {
			tokenOut.safeTransfer(_settlementAddress, amountOut);
		}

		uint256 inAfter = tokenIn.balanceOf(address(this));
		uint256 amountIn = inBefore - inAfter;

		emit Executed(
			params.target,
			params.tokenIn,
			params.tokenOut,
			amountIn,
			amountOut
		);
	}

	/// =====================
	/// ======= Views =======
	/// =====================

	function owner() external view returns (address) {
		return _owner;
	}

	function operator() external view returns (address) {
		return _operator;
	}

	function rules()
		external
		view
		returns (
			uint16 maxSlippageBps,
			uint256 minTradeAmount,
			address settlementAddress
		)
	{
		return (_maxSlippageBps, _minTradeAmount, _settlementAddress);
	}

	function targetTokens() external view returns (address[] memory) {
		return _targetTokens;
	}

	function isTargetToken(address token) external view returns (bool) {
		return _isTargetToken[token];
	}

	/// =====================
	/// ====== Internal =====
	/// =====================

	function _initOwnerOperator(address owner_, address operator_) internal {
		if (isZeroAddress(owner_) || isZeroAddress(operator_)) {
			revert INVALID_ADDRESS();
		}
		_owner = owner_;
		_operator = operator_;
		emit Initialized(owner_, operator_);
	}

	function _setRules(Types.UserRules calldata rules_) internal {
		if (isZeroAddress(rules_.settlementAddress)) revert INVALID_RULES();
		if (rules_.targetTokens.length == 0) revert INVALID_RULES();
		if (rules_.maxSlippageBps > MAX_SLIPPAGE_BPS) revert INVALID_RULES();

		// Clear previous whitelist before writing the new one.
		uint256 prevLen = _targetTokens.length;
		for (uint256 i; i < prevLen; ++i) {
			_isTargetToken[_targetTokens[i]] = false;
		}
		delete _targetTokens;

		_maxSlippageBps = rules_.maxSlippageBps;
		_minTradeAmount = rules_.minTradeAmount;
		_settlementAddress = rules_.settlementAddress;

		uint256 newLen = rules_.targetTokens.length;
		for (uint256 i; i < newLen; ++i) {
			address t = rules_.targetTokens[i];
			if (isZeroAddress(t)) revert INVALID_RULES();
			_targetTokens.push(t);
			_isTargetToken[t] = true;
		}
		_rulesSet = true;

		emit RulesUpdated(
			rules_.maxSlippageBps,
			rules_.minTradeAmount,
			rules_.settlementAddress,
			rules_.targetTokens
		);
	}

	/// @dev E-02: approvals are scoped to `amount` (the current token balance used
	///      as a safe upper bound). The caller MUST revoke the target approval
	///      after the swap call to enforce least-privilege.
	function _ensureApprovals(
		address tokenIn,
		address target,
		uint256 amount
	) internal returns (address permit2) {
		permit2 = IStreamVaultsConfig(IStreamVaults(_operator).config()).permit2();
		IERC20 token = IERC20(tokenIn);
		if (!isZeroAddress(permit2)) {
			// (1) ERC20-approve Permit2 to custody the pull (bounded to `amount`).
			token.forceApprove(permit2, amount);
			// (2) Authorize the swap target as a Permit2 spender. The Uniswap
			//     Universal Router pulls ERC20s THROUGH Permit2, so without this
			//     the router's transfer reverts (surfaces as SWAP_CALL_FAILED).
			//     Bounded to `amount`; revoked after the swap (least privilege).
			IPermit2(permit2).approve(
				tokenIn,
				target,
				_toUint160(amount),
				type(uint48).max
			);
		}
		// Some routers pull via a plain ERC20 allowance instead — grant that too.
		token.forceApprove(target, amount);
	}

	/// @dev Permit2 amounts are uint160; clamp (our trade sizes never approach
	///      this, but a safe cast avoids silent truncation).
	function _toUint160(uint256 value) internal pure returns (uint160) {
		return value > type(uint160).max ? type(uint160).max : uint160(value);
	}

	receive() external payable {}
}
