// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {FarmChainTypes} from "./libraries/FarmChainTypes.sol";
import {IUserRegistry} from "./interfaces/IUserRegistry.sol";

/// @title RoleManager
/// @notice Single source of truth for FarmChain permissions. Every other contract asks this
///         contract whether an address holds a role and whether it is verified, so there is
///         exactly one authorization system.
/// @dev    Participants self-register in UserRegistry with a *requested* role. Only an admin
///         (DEFAULT_ADMIN_ROLE) can verify them, which grants the requested AccessControl role.
///         Participant roles can never be granted through the generic `grantRole` path, so the
///         verification step cannot be bypassed by accident.
contract RoleManager is AccessControl {
    bytes32 public constant FARMER_ROLE = keccak256("FARMER_ROLE");
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    bytes32 public constant WAREHOUSE_ROLE = keccak256("WAREHOUSE_ROLE");
    bytes32 public constant RETAILER_ROLE = keccak256("RETAILER_ROLE");

    uint256 public constant MAX_REASON_LENGTH = 256;

    IUserRegistry public userRegistry;

    mapping(address => FarmChainTypes.VerificationStatus) private _status;
    mapping(address => uint64) public verifiedAt;

    event UserRegistryConfigured(address indexed userRegistry);
    event ParticipantVerified(address indexed account, bytes32 indexed role, address indexed admin, uint256 timestamp);
    event ParticipantRejected(address indexed account, address indexed admin, string reason, uint256 timestamp);
    event VerificationRevoked(address indexed account, address indexed admin, string reason, uint256 timestamp);
    event ParticipantRoleGranted(address indexed account, bytes32 indexed role, address indexed admin);
    event ParticipantRoleRevoked(address indexed account, bytes32 indexed role, address indexed admin);

    error ZeroAddress();
    error UserRegistryAlreadySet();
    error UserRegistryNotSet();
    error NotRegistered(address account);
    error NotParticipantRole(bytes32 role);
    error AlreadyVerified(address account);
    error NotVerified(address account);
    error UseParticipantRoleFunctions();
    error ReasonTooLong();

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // Configuration
    // ---------------------------------------------------------------------

    /// @notice One-time wiring of the UserRegistry (needed to look up requested roles).
    function setUserRegistry(address registry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (registry == address(0)) revert ZeroAddress();
        if (address(userRegistry) != address(0)) revert UserRegistryAlreadySet();
        userRegistry = IUserRegistry(registry);
        emit UserRegistryConfigured(registry);
    }

    // ---------------------------------------------------------------------
    // Verification
    // ---------------------------------------------------------------------

    /// @notice Approve a registered participant and grant the role they requested.
    function verifyParticipant(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(userRegistry) == address(0)) revert UserRegistryNotSet();
        if (!userRegistry.isRegistered(account)) revert NotRegistered(account);
        if (_status[account] == FarmChainTypes.VerificationStatus.Verified) revert AlreadyVerified(account);

        bytes32 role = roleFor(userRegistry.getUserRole(account));
        _status[account] = FarmChainTypes.VerificationStatus.Verified;
        verifiedAt[account] = uint64(block.timestamp);
        _grantRole(role, account);

        emit ParticipantVerified(account, role, msg.sender, block.timestamp);
    }

    /// @notice Reject a pending registration. Use `revokeVerification` for verified participants.
    function rejectParticipant(address account, string calldata reason) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(userRegistry) == address(0)) revert UserRegistryNotSet();
        if (!userRegistry.isRegistered(account)) revert NotRegistered(account);
        if (_status[account] == FarmChainTypes.VerificationStatus.Verified) revert AlreadyVerified(account);
        if (bytes(reason).length > MAX_REASON_LENGTH) revert ReasonTooLong();

        _status[account] = FarmChainTypes.VerificationStatus.Rejected;
        emit ParticipantRejected(account, msg.sender, reason, block.timestamp);
    }

    /// @notice Revoke a verified participant. All participant roles are removed immediately,
    ///         which blocks every write in ProductRegistry / SupplyChainTracker / PaymentEscrow.
    function revokeVerification(address account, string calldata reason) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_status[account] != FarmChainTypes.VerificationStatus.Verified) revert NotVerified(account);
        if (bytes(reason).length > MAX_REASON_LENGTH) revert ReasonTooLong();

        _status[account] = FarmChainTypes.VerificationStatus.Revoked;
        verifiedAt[account] = 0;
        _revokeRole(FARMER_ROLE, account);
        _revokeRole(DISTRIBUTOR_ROLE, account);
        _revokeRole(WAREHOUSE_ROLE, account);
        _revokeRole(RETAILER_ROLE, account);

        emit VerificationRevoked(account, msg.sender, reason, block.timestamp);
    }

    // ---------------------------------------------------------------------
    // Participant role administration
    // ---------------------------------------------------------------------

    /// @notice Grant an additional participant role to an already-verified participant.
    function grantParticipantRole(address account, bytes32 role) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!isParticipantRole(role)) revert NotParticipantRole(role);
        if (_status[account] != FarmChainTypes.VerificationStatus.Verified) revert NotVerified(account);
        _grantRole(role, account);
        emit ParticipantRoleGranted(account, role, msg.sender);
    }

    function revokeParticipantRole(address account, bytes32 role) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!isParticipantRole(role)) revert NotParticipantRole(role);
        _revokeRole(role, account);
        emit ParticipantRoleRevoked(account, role, msg.sender);
    }

    /// @dev Participant roles must go through verification / grantParticipantRole.
    ///      Admin roles still use the standard AccessControl flow.
    function grantRole(bytes32 role, address account) public override {
        if (isParticipantRole(role)) revert UseParticipantRoleFunctions();
        super.grantRole(role, account);
    }

    function revokeRole(bytes32 role, address account) public override {
        if (isParticipantRole(role)) revert UseParticipantRoleFunctions();
        super.revokeRole(role, account);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function isVerifiedParticipant(address account) public view returns (bool) {
        return _status[account] == FarmChainTypes.VerificationStatus.Verified;
    }

    /// @notice True only if the account is verified AND currently holds `role`.
    function hasVerifiedRole(address account, bytes32 role) external view returns (bool) {
        return isVerifiedParticipant(account) && hasRole(role, account);
    }

    function verificationStatus(address account) external view returns (FarmChainTypes.VerificationStatus) {
        return _status[account];
    }

    function isAdmin(address account) external view returns (bool) {
        return hasRole(DEFAULT_ADMIN_ROLE, account);
    }

    function isParticipantRole(bytes32 role) public pure returns (bool) {
        return role == FARMER_ROLE || role == DISTRIBUTOR_ROLE || role == WAREHOUSE_ROLE || role == RETAILER_ROLE;
    }

    function roleFor(FarmChainTypes.Role role) public pure returns (bytes32) {
        if (role == FarmChainTypes.Role.Farmer) return FARMER_ROLE;
        if (role == FarmChainTypes.Role.Distributor) return DISTRIBUTOR_ROLE;
        if (role == FarmChainTypes.Role.Warehouse) return WAREHOUSE_ROLE;
        if (role == FarmChainTypes.Role.Retailer) return RETAILER_ROLE;
        revert NotParticipantRole(bytes32(0));
    }
}
