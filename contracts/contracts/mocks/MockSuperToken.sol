// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title MockSuperToken
/// @notice Minimal SuperToken mock that implements getUnderlyingToken,
///         getUnderlyingDecimals, upgradeTo, and downgrade for testing.
contract MockSuperToken is ERC20 {
    using SafeERC20 for IERC20;

    address private _underlying;
    uint8 private _underlyingDecimals;

    constructor(
        string memory name_,
        string memory symbol_,
        address underlying_,
        uint8 underlyingDecimals_
    ) ERC20(name_, symbol_) {
        _underlying = underlying_;
        _underlyingDecimals = underlyingDecimals_;
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function getUnderlyingToken() external view returns (address) {
        return _underlying;
    }

    function getUnderlyingDecimals() external view returns (uint8) {
        return _underlyingDecimals;
    }

    /// @notice Wraps `underlyingAmount` of underlying (in underlying decimals) into
    ///         18-dec super tokens for `to`. `amount` is in 18-dec (super token units).
    /// @dev StreamVaults calls: forceApprove(underlying -> superToken, underlyingAmount)
    ///      then upgradeTo(user, superAmount=underlyingAmount*1e12, ""). So the contract
    ///      receives `underlyingAmount` in native decimals but the `amount` param is 18-dec.
    ///      We pull the underlying amount from msg.sender using allowance-based transfer.
    function upgradeTo(
        address to,
        uint256 amount,
        bytes calldata /* data */
    ) external {
        // Compute underlying amount from 18-dec super amount:
        // underlying = superAmount / 10^(18 - underlyingDecimals)
        uint256 underlyingAmount = amount / (10 ** (18 - uint256(_underlyingDecimals)));
        // Pull underlying from msg.sender (the wrapping party is the gateway).
        IERC20(_underlying).safeTransferFrom(msg.sender, address(this), underlyingAmount);
        // Mint super tokens (18-dec) to `to`.
        _mint(to, amount);
    }

    /// @notice Burns `amount` of 18-dec super tokens from msg.sender and returns
    ///         the equivalent underlying amount (scaled to underlyingDecimals).
    function downgrade(uint256 amount) external {
        _burn(msg.sender, amount);
        // Scale super token amount (18 dec) back to underlying decimals
        uint256 underlyingAmount = amount / (10 ** (18 - uint256(_underlyingDecimals)));
        IERC20(_underlying).safeTransfer(msg.sender, underlyingAmount);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// =====================
    /// == Realtime balance ==
    /// =====================
    /// @dev Lets tests drive `closeStreamIfLow`: set an explicit
    ///      (availableBalance, deposit) per account to exercise the
    ///      threshold branches. Unset accounts fall back to (balanceOf, 0).

    mapping(address => int256) private _rtAvailable;
    mapping(address => uint256) private _rtDeposit;
    mapping(address => bool) private _rtSet;

    function setRealtimeBalance(
        address account,
        int256 availableBalance,
        uint256 deposit
    ) external {
        _rtAvailable[account] = availableBalance;
        _rtDeposit[account] = deposit;
        _rtSet[account] = true;
    }

    function realtimeBalanceOfNow(
        address account
    )
        external
        view
        returns (
            int256 availableBalance,
            uint256 deposit,
            uint256 owedDeposit,
            uint256 timestamp
        )
    {
        if (_rtSet[account]) {
            return (_rtAvailable[account], _rtDeposit[account], 0, block.timestamp);
        }
        return (int256(balanceOf(account)), 0, 0, block.timestamp);
    }
}
