// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FarmChainTypes} from "../libraries/FarmChainTypes.sol";

interface IProductRegistry {
    function batchExists(uint256 batchId) external view returns (bool);
    function getBatchOwner(uint256 batchId) external view returns (address);
    function getBatchFarmer(uint256 batchId) external view returns (address);
    function getBatchStatus(uint256 batchId) external view returns (FarmChainTypes.Stage);
    function setOwner(uint256 batchId, address newOwner) external;
    function setStatus(uint256 batchId, FarmChainTypes.Stage newStatus) external;
}
