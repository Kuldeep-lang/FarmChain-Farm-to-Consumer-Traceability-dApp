// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FarmChainTypes} from "./libraries/FarmChainTypes.sol";
import {IRoleManager} from "./interfaces/IRoleManager.sol";

/// @title UserRegistry
/// @notice Public profiles of supply-chain participants.
/// @dev    Only non-confidential profile data is stored on-chain (name, organization, location).
///         Email / phone are kept off-chain by the backend. The `role` stored here is the role the
///         participant *requested*; it confers no permission until an admin verifies the
///         participant in RoleManager, which then grants the matching AccessControl role.
contract UserRegistry {
    struct User {
        address wallet;
        string name;
        string organization;
        string location;
        FarmChainTypes.Role role;
        uint64 registeredAt;
        uint64 updatedAt;
    }

    struct UserView {
        address wallet;
        string name;
        string organization;
        string location;
        FarmChainTypes.Role role;
        uint64 registeredAt;
        uint64 updatedAt;
        FarmChainTypes.VerificationStatus verification;
        bool roleActive; // true when the requested role is currently granted and verified
    }

    uint256 public constant MAX_FIELD_LENGTH = 128;

    IRoleManager public immutable roleManager;

    mapping(address => User) private _users;
    address[] private _userList;

    event UserRegistered(address indexed account, FarmChainTypes.Role indexed role, string name, uint256 timestamp);
    event UserProfileUpdated(address indexed account, string name, string organization, string location, uint256 timestamp);

    error ZeroAddress();
    error AlreadyRegistered(address account);
    error NotRegistered(address account);
    error InvalidRole();
    error EmptyField(string field);
    error FieldTooLong(string field);

    constructor(address roleManager_) {
        if (roleManager_ == address(0)) revert ZeroAddress();
        roleManager = IRoleManager(roleManager_);
    }

    /// @notice Register the caller as a participant requesting `role`.
    function registerUser(
        string calldata name,
        string calldata organization,
        string calldata location,
        FarmChainTypes.Role role
    ) external {
        if (_users[msg.sender].registeredAt != 0) revert AlreadyRegistered(msg.sender);
        if (role == FarmChainTypes.Role.None) revert InvalidRole();
        _validateProfile(name, organization, location);

        _users[msg.sender] = User({
            wallet: msg.sender,
            name: name,
            organization: organization,
            location: location,
            role: role,
            registeredAt: uint64(block.timestamp),
            updatedAt: uint64(block.timestamp)
        });
        _userList.push(msg.sender);

        emit UserRegistered(msg.sender, role, name, block.timestamp);
    }

    /// @notice Update descriptive profile fields. The requested role cannot be changed.
    function updateUserProfile(string calldata name, string calldata organization, string calldata location) external {
        User storage user = _users[msg.sender];
        if (user.registeredAt == 0) revert NotRegistered(msg.sender);
        _validateProfile(name, organization, location);

        user.name = name;
        user.organization = organization;
        user.location = location;
        user.updatedAt = uint64(block.timestamp);

        emit UserProfileUpdated(msg.sender, name, organization, location, block.timestamp);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getUser(address account) public view returns (UserView memory) {
        User storage u = _users[account];
        if (u.registeredAt == 0) revert NotRegistered(account);
        FarmChainTypes.VerificationStatus status = roleManager.verificationStatus(account);
        bool active = status == FarmChainTypes.VerificationStatus.Verified && roleManager.hasRole(_roleId(u.role), account);
        return UserView(u.wallet, u.name, u.organization, u.location, u.role, u.registeredAt, u.updatedAt, status, active);
    }

    function isRegistered(address account) external view returns (bool) {
        return _users[account].registeredAt != 0;
    }

    function getUserRole(address account) external view returns (FarmChainTypes.Role) {
        return _users[account].role;
    }

    function totalUsers() external view returns (uint256) {
        return _userList.length;
    }

    /// @notice Paginated list of registered wallets.
    function getUsers(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        uint256 total = _userList.length;
        if (offset >= total) return new address[](0);
        uint256 end = offset + limit > total ? total : offset + limit;
        page = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) page[i - offset] = _userList[i];
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _roleId(FarmChainTypes.Role role) private view returns (bytes32) {
        if (role == FarmChainTypes.Role.Farmer) return roleManager.FARMER_ROLE();
        if (role == FarmChainTypes.Role.Distributor) return roleManager.DISTRIBUTOR_ROLE();
        if (role == FarmChainTypes.Role.Warehouse) return roleManager.WAREHOUSE_ROLE();
        return roleManager.RETAILER_ROLE();
    }

    function _validateProfile(string calldata name, string calldata organization, string calldata location) private pure {
        if (bytes(name).length == 0) revert EmptyField("name");
        if (bytes(location).length == 0) revert EmptyField("location");
        if (bytes(name).length > MAX_FIELD_LENGTH) revert FieldTooLong("name");
        if (bytes(organization).length > MAX_FIELD_LENGTH) revert FieldTooLong("organization");
        if (bytes(location).length > MAX_FIELD_LENGTH) revert FieldTooLong("location");
    }
}
