// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ISupplyChainTracker {
    function onBatchRegistered(
        uint256 batchId,
        address farmer,
        uint64 harvestDate,
        string calldata farmLocation,
        string calldata metadataCID
    ) external;

    function onMetadataUpdated(uint256 batchId, address farmer, string calldata newMetadataCID) external;

    function hasPendingTransfer(uint256 batchId) external view returns (bool);
}
