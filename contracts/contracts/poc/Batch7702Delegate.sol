// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC7821} from "@openzeppelin/contracts/account/extensions/draft-ERC7821.sol";

/// @title Batch7702Delegate
/// @notice Minimal EIP-7702 delegate: the audited OpenZeppelin ERC-7821 batch
///         executor with the default authorizer (`caller == address(this)`).
///         An EOA sets its code to this via a 7702 delegation authorization, then
///         calls `execute(mode, executionData)` on ITSELF — so the inner batched
///         calls run with `msg.sender == the EOA`. That is exactly what
///         StreamVaults' setup needs: `CFAv1Forwarder.grantPermissions` requires
///         `msg.sender == flowSender` (the user), and `startStreamBot` then runs
///         atomically in the same transaction.
/// @dev No storage, no init — stateless, safe to use as 7702 delegate code.
///      ERC-7821 batch mode only (`0x01000…`); no opData.
// solhint-disable-next-line no-empty-blocks
contract Batch7702Delegate is ERC7821 {}
