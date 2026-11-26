// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {FarmChainTypes} from "./libraries/FarmChainTypes.sol";
import {IRoleManager} from "./interfaces/IRoleManager.sol";
import {ISupplyChainTracker} from "./interfaces/ISupplyChainTracker.sol";

/// @title ProductRegistry
/// @notice Digital identity of every agricultural batch.
/// @dev    Batch IDs are sequential (starting at 10001, displayed as "FC-10001") and therefore
///         unique by construction. Registration requires the caller to pass the ID they expect
///         (`expectedBatchId == nextBatchId`) so that off-chain IPFS metadata can embed the real
///         batch ID *before* the transaction is sent; if another farmer registers first the call
///         reverts with BatchIdMismatch and the frontend rebuilds the metadata.
///         Ownership and status can only be changed by the SupplyChainTracker contract, which
///         enforces the transfer / stage rules. Nobody (not even the admin) can overwrite a batch.
contract ProductRegistry is Pausable {
    struct Batch {
        uint256 id;
        address farmer;
        string productName;
        string category;
        uint256 quantity;
        string unit;
        uint64 harvestDate;
        string farmLocation;
        string metadataCID;
        uint64 createdAt;
        address currentOwner;
        FarmChainTypes.Stage status;
    }

    struct BatchInput {
        string productName;
        string category;
        uint256 quantity;
        string unit;
        uint64 harvestDate;
        string farmLocation;
        string metadataCID;
    }

    uint256 public constant FIRST_BATCH_ID = 10001;
    uint256 public constant MAX_FIELD_LENGTH = 128;
    /// @dev Tolerance for client/validator clock differences when validating the harvest date.
    uint256 public constant HARVEST_DATE_TOLERANCE = 1 days;

    IRoleManager public immutable roleManager;
    ISupplyChainTracker public tracker;

    uint256 public nextBatchId = FIRST_BATCH_ID;

    mapping(uint256 => Batch) private _batches;
    mapping(address => uint256[]) private _farmerBatches;
    /// @dev keccak256(metadataCID) => used. Prevents the same metadata document from being
    ///      registered twice (duplicate batch protection beyond the sequential ID).
    mapping(bytes32 => bool) public metadataUsed;

    event TrackerConfigured(address indexed tracker);
    event BatchRegistered(
        uint256 indexed batchId,
        address indexed farmer,
        string productName,
        string category,
        uint256 quantity,
        string unit,
        string metadataCID,
        uint256 timestamp
    );
    event BatchMetadataUpdated(uint256 indexed batchId, address indexed farmer, string oldMetadataCID, string newMetadataCID, uint256 timestamp);
    event BatchOwnerChanged(uint256 indexed batchId, address indexed previousOwner, address indexed newOwner);
    event BatchStatusChanged(uint256 indexed batchId, FarmChainTypes.Stage previousStatus, FarmChainTypes.Stage newStatus);

    error ZeroAddress();
    error NotAdmin();
    error NotVerifiedFarmer(address account);
    error TrackerAlreadySet();
    error TrackerNotSet();
    error OnlyTracker();
    error BatchIdMismatch(uint256 expected, uint256 actual);
    error BatchNotFound(uint256 batchId);
    error DuplicateMetadata(string metadataCID);
    error InvalidQuantity();
    error InvalidHarvestDate();
    error EmptyField(string field);
    error FieldTooLong(string field);
    error NotBatchFarmer();
    error MetadataLocked();

    modifier onlyAdmin() {
        if (!roleManager.isAdmin(msg.sender)) revert NotAdmin();
        _;
    }

    modifier onlyTracker() {
        if (msg.sender != address(tracker)) revert OnlyTracker();
        _;
    }

    modifier batchMustExist(uint256 batchId) {
        if (_batches[batchId].createdAt == 0) revert BatchNotFound(batchId);
        _;
    }

    constructor(address roleManager_) {
        if (roleManager_ == address(0)) revert ZeroAddress();
        roleManager = IRoleManager(roleManager_);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice One-time wiring of the SupplyChainTracker that is allowed to move batches.
    function setTracker(address tracker_) external onlyAdmin {
        if (tracker_ == address(0)) revert ZeroAddress();
        if (address(tracker) != address(0)) revert TrackerAlreadySet();
        tracker = ISupplyChainTracker(tracker_);
        emit TrackerConfigured(tracker_);
    }

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Farmer actions
    // ---------------------------------------------------------------------

    /// @notice Register a new batch. Caller must be a verified farmer.
    /// @param expectedBatchId must equal `nextBatchId` (see contract docs).
    /// @return batchId the newly created batch ID.
    function registerBatch(uint256 expectedBatchId, BatchInput calldata input) external whenNotPaused returns (uint256 batchId) {
        if (address(tracker) == address(0)) revert TrackerNotSet();
        if (!roleManager.hasVerifiedRole(msg.sender, roleManager.FARMER_ROLE())) revert NotVerifiedFarmer(msg.sender);
        batchId = nextBatchId;
        if (expectedBatchId != batchId) revert BatchIdMismatch(expectedBatchId, batchId);
        _validateInput(input);

        if (bytes(input.metadataCID).length != 0) {
            bytes32 key = keccak256(bytes(input.metadataCID));
            if (metadataUsed[key]) revert DuplicateMetadata(input.metadataCID);
            metadataUsed[key] = true;
        }

        nextBatchId = batchId + 1;
        Batch storage b = _batches[batchId];
        b.id = batchId;
        b.farmer = msg.sender;
        b.productName = input.productName;
        b.category = input.category;
        b.quantity = input.quantity;
        b.unit = input.unit;
        b.harvestDate = input.harvestDate;
        b.farmLocation = input.farmLocation;
        b.metadataCID = input.metadataCID;
        b.createdAt = uint64(block.timestamp);
        b.currentOwner = msg.sender;
        b.status = FarmChainTypes.Stage.REGISTERED;
        _farmerBatches[msg.sender].push(batchId);

        emit BatchRegistered(
            batchId,
            msg.sender,
            input.productName,
            input.category,
            input.quantity,
            input.unit,
            input.metadataCID,
            block.timestamp
        );

        // Records the HARVESTED and REGISTERED entries in the immutable history.
        tracker.onBatchRegistered(batchId, msg.sender, input.harvestDate, input.farmLocation, input.metadataCID);
    }

    /// @notice Attach corrected/extended metadata. Only allowed while the batch is still with the
    ///         original farmer (status REGISTERED, no pending transfer). The previous CID remains
    ///         in the event log and in the SupplyChainTracker history, so nothing is lost.
    function updateBatchMetadata(uint256 batchId, string calldata newMetadataCID) external whenNotPaused batchMustExist(batchId) {
        Batch storage b = _batches[batchId];
        if (b.farmer != msg.sender) revert NotBatchFarmer();
        if (!roleManager.hasVerifiedRole(msg.sender, roleManager.FARMER_ROLE())) revert NotVerifiedFarmer(msg.sender);
        if (b.currentOwner != msg.sender || b.status != FarmChainTypes.Stage.REGISTERED || tracker.hasPendingTransfer(batchId)) {
            revert MetadataLocked();
        }
        if (bytes(newMetadataCID).length == 0) revert EmptyField("metadataCID");
        if (bytes(newMetadataCID).length > MAX_FIELD_LENGTH) revert FieldTooLong("metadataCID");
        bytes32 key = keccak256(bytes(newMetadataCID));
        if (metadataUsed[key]) revert DuplicateMetadata(newMetadataCID);
        metadataUsed[key] = true;

        string memory old = b.metadataCID;
        b.metadataCID = newMetadataCID;
        emit BatchMetadataUpdated(batchId, msg.sender, old, newMetadataCID, block.timestamp);
        tracker.onMetadataUpdated(batchId, msg.sender, newMetadataCID);
    }

    // ---------------------------------------------------------------------
    // Tracker-only mutators
    // ---------------------------------------------------------------------

    function setOwner(uint256 batchId, address newOwner) external onlyTracker batchMustExist(batchId) {
        if (newOwner == address(0)) revert ZeroAddress();
        address previous = _batches[batchId].currentOwner;
        _batches[batchId].currentOwner = newOwner;
        emit BatchOwnerChanged(batchId, previous, newOwner);
    }

    function setStatus(uint256 batchId, FarmChainTypes.Stage newStatus) external onlyTracker batchMustExist(batchId) {
        FarmChainTypes.Stage previous = _batches[batchId].status;
        _batches[batchId].status = newStatus;
        emit BatchStatusChanged(batchId, previous, newStatus);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getBatch(uint256 batchId) external view batchMustExist(batchId) returns (Batch memory) {
        return _batches[batchId];
    }

    function getFarmerBatches(address farmer) external view returns (uint256[] memory) {
        return _farmerBatches[farmer];
    }

    function getBatchOwner(uint256 batchId) external view batchMustExist(batchId) returns (address) {
        return _batches[batchId].currentOwner;
    }

    function getBatchFarmer(uint256 batchId) external view batchMustExist(batchId) returns (address) {
        return _batches[batchId].farmer;
    }

    function getBatchStatus(uint256 batchId) external view batchMustExist(batchId) returns (FarmChainTypes.Stage) {
        return _batches[batchId].status;
    }

    function batchExists(uint256 batchId) external view returns (bool) {
        return _batches[batchId].createdAt != 0;
    }

    function totalBatches() external view returns (uint256) {
        return nextBatchId - FIRST_BATCH_ID;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _validateInput(BatchInput calldata input) private view {
        if (bytes(input.productName).length == 0) revert EmptyField("productName");
        if (bytes(input.category).length == 0) revert EmptyField("category");
        if (bytes(input.unit).length == 0) revert EmptyField("unit");
        if (bytes(input.farmLocation).length == 0) revert EmptyField("farmLocation");
        if (bytes(input.productName).length > MAX_FIELD_LENGTH) revert FieldTooLong("productName");
        if (bytes(input.category).length > MAX_FIELD_LENGTH) revert FieldTooLong("category");
        if (bytes(input.unit).length > 32) revert FieldTooLong("unit");
        if (bytes(input.farmLocation).length > MAX_FIELD_LENGTH) revert FieldTooLong("farmLocation");
        if (bytes(input.metadataCID).length > MAX_FIELD_LENGTH) revert FieldTooLong("metadataCID");
        if (input.quantity == 0) revert InvalidQuantity();
        if (input.harvestDate == 0 || input.harvestDate > block.timestamp + HARVEST_DATE_TOLERANCE) revert InvalidHarvestDate();
    }
}
