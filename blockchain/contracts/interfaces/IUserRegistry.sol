// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FarmChainTypes} from "../libraries/FarmChainTypes.sol";

interface IUserRegistry {
    function isRegistered(address account) external view returns (bool);
    function getUserRole(address account) external view returns (FarmChainTypes.Role);
}
