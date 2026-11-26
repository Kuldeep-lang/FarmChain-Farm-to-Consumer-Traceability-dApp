// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FarmChainTypes} from "../libraries/FarmChainTypes.sol";

interface IRoleManager {
    function FARMER_ROLE() external view returns (bytes32);
    function DISTRIBUTOR_ROLE() external view returns (bytes32);
    function WAREHOUSE_ROLE() external view returns (bytes32);
    function RETAILER_ROLE() external view returns (bytes32);

    function hasRole(bytes32 role, address account) external view returns (bool);
    function isAdmin(address account) external view returns (bool);
    function isVerifiedParticipant(address account) external view returns (bool);
    function hasVerifiedRole(address account, bytes32 role) external view returns (bool);
    function verificationStatus(address account) external view returns (FarmChainTypes.VerificationStatus);
}
