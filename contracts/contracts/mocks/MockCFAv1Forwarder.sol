// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title MockCFAv1Forwarder
/// @notice Stub for Superfluid CFAv1Forwarder. Records the last flow and
///         returns it for getFlowrate queries.
contract MockCFAv1Forwarder {
    struct FlowKey {
        address token;
        address sender;
        address receiver;
    }

    mapping(bytes32 => int96) private _flows;

    bool public revertOnSetFlow;

    function setRevertOnSetFlow(bool should) external {
        revertOnSetFlow = should;
    }

    function _key(
        address token,
        address sender,
        address receiver
    ) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(token, sender, receiver));
    }

    function getFlowrate(
        address token,
        address sender,
        address receiver
    ) external view returns (int96) {
        return _flows[_key(token, sender, receiver)];
    }

    function setFlowrateFrom(
        address token,
        address sender,
        address receiver,
        int96 flowrate
    ) external returns (bool) {
        if (revertOnSetFlow) revert("MockCFA: forced revert");
        _flows[_key(token, sender, receiver)] = flowrate;
        return true;
    }
}
