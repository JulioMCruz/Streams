// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title MockUniswapRouter
/// @notice Stub swap router for testing. When called:
///         - Pulls tokenIn from the caller (SmartAccountDCA) via transferFrom.
///         - Transfers pre-funded amountOut of tokenOut to the caller.
/// @dev The test setup must pre-fund this router with sufficient tokenOut tokens.
///      Configure tokenIn/tokenOut/amountOut via `configure()` before each test.
contract MockUniswapRouter {
    using SafeERC20 for IERC20;

    address public tokenIn;
    address public tokenOut;
    uint256 public amountOut;
    bool public shouldFail;

    function configure(
        address tokenIn_,
        address tokenOut_,
        uint256 amountOut_,
        bool shouldFail_
    ) external {
        tokenIn = tokenIn_;
        tokenOut = tokenOut_;
        amountOut = amountOut_;
        shouldFail = shouldFail_;
    }

    /// @notice Explicit swap function — called by SmartAccountDCA via low-level call.
    ///         Any calldata routes here. Pulls tokenIn from caller, pushes amountOut of tokenOut.
    function swap() external {
        require(!shouldFail, "MockRouter: forced swap failure");

        // Pull all tokenIn from the caller
        if (tokenIn != address(0)) {
            uint256 inBal = IERC20(tokenIn).balanceOf(msg.sender);
            if (inBal > 0) {
                IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), inBal);
            }
        }

        // Transfer tokenOut to the caller from this contract's balance
        if (amountOut > 0 && tokenOut != address(0)) {
            IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
        }
    }

    /// @notice Fallback handles ALL calls — including empty calldata (empty = receive pattern).
    ///         We intentionally omit `receive()` so this handles ETH + any calldata.
    fallback() external payable {
        require(!shouldFail, "MockRouter: forced swap failure");

        if (tokenIn != address(0)) {
            uint256 inBal = IERC20(tokenIn).balanceOf(msg.sender);
            if (inBal > 0) {
                IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), inBal);
            }
        }

        if (amountOut > 0 && tokenOut != address(0)) {
            IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
        }
    }
}

/// @dev Minimal mintable ERC20 used as tokenOut in tests.
///      Deployed separately so the router can hold a pre-funded balance.
contract MockMintableERC20 is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public override totalSupply;
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        require(balanceOf[msg.sender] >= amount, "MockERC20: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external override returns (bool) {
        require(balanceOf[from] >= amount, "MockERC20: insufficient balance");
        require(allowance[from][msg.sender] >= amount, "MockERC20: insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
