// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Minimal view of the official ERC-8004 IdentityRegistry (agents are ERC-721 tokens).
interface IERC8004Identity {
    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool);
}

/// @title SignalMindRegistry
/// @notice Append-only log of SignalMind Guard verdicts on trading-agent orders.
/// Agent identity lives in the official ERC-8004 IdentityRegistry; this contract only
/// records verdicts, and only the owner (or an approved operator) of an agent identity
/// can record verdicts under that agentId. ERC-8004's ValidationRegistry is not yet
/// deployed on any network, so verdicts are kept here with the same hash-commitment idea.
contract SignalMindRegistry {
    enum Decision { Approve, Reject, Escalate }

    IERC8004Identity public immutable identityRegistry;

    /// verdictHash => block timestamp it was recorded at (0 = never).
    mapping(bytes32 => uint256) public recordedAt;
    mapping(uint256 => uint256) public verdictCount;

    event VerdictRecorded(
        uint256 indexed agentId,
        bytes32 indexed verdictHash,
        uint8 decision,
        string subject,
        address indexed recorder
    );

    error NotAgentOwner();
    error BadDecision();
    error AlreadyRecorded();

    constructor(address identityRegistry_) {
        identityRegistry = IERC8004Identity(identityRegistry_);
    }

    /// @param decision 0 approve, 1 reject, 2 escalate
    /// @param subject short human-readable subject, e.g. "BTC-USDT buy 0.01"
    function recordVerdict(uint256 agentId, bytes32 verdictHash, uint8 decision, string calldata subject) external {
        if (!identityRegistry.isAuthorizedOrOwner(msg.sender, agentId)) revert NotAgentOwner();
        if (decision > uint8(Decision.Escalate)) revert BadDecision();
        if (recordedAt[verdictHash] != 0) revert AlreadyRecorded();
        recordedAt[verdictHash] = block.timestamp;
        verdictCount[agentId] += 1;
        emit VerdictRecorded(agentId, verdictHash, decision, subject, msg.sender);
    }
}
