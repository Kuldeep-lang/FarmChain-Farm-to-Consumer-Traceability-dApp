// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {FarmChainTypes} from "./libraries/FarmChainTypes.sol";
import {IRoleManager} from "./interfaces/IRoleManager.sol";
import {IProductRegistry} from "./interfaces/IProductRegistry.sol";

/// @title SupplyChainTracker
/// @notice Append-only movement history of every batch plus the custody state machine.
/// @dev    Custody rules (all parties must be verified in RoleManager):
///           Farmer      -> Distributor
///           Distributor -> Warehouse | Retailer
///           Warehouse   -> Retailer  | Distributor
///         Ownership changes only when the recipient explicitly calls acceptTransfer().
///         History entries are never modified or deleted.
contract SupplyChainTracker is Pausable {
    enum Action {
        Harvested,
        Registered,
        TransferInitiated,
        TransferAccepted,
        TransferRejected,
        TransferCancelled,
        ShipmentRecorded,
        WarehouseArrival,
        QualityInspectionPassed,
        QualityInspectionFailed,
        RetailArrival,
        OutForDelivery,
        AvailableForSale,
        Sold,
        Recalled,
        MetadataUpdated
    }

    struct HistoryEntry {
        uint256 batchId;
        Action action;
        FarmChainTypes.Stage stage;
        address previousOwner;
        address newOwner;
        address actor; // transaction sender
        uint64 timestamp;
        string location;
        string metadataCID;
    }

    struct PendingTransfer {
        address from;
        address to;
        uint64 createdAt;
        string location;
        string metadataCID;
        bool active;
    }

    uint256 public constant MAX_FIELD_LENGTH = 128;
    uint256 public constant MAX_REASON_LENGTH = 256;

    IRoleManager public immutable roleManager;
    IProductRegistry public immutable productRegistry;

    mapping(uint256 => HistoryEntry[]) private _history;
    mapping(uint256 => PendingTransfer) private _pending;
    /// @dev Every batch a participant has owned or been offered (for on-chain dashboards).
    mapping(address => uint256[]) private _participantBatches;
    mapping(address => mapping(uint256 => bool)) private _participantHasBatch;

    event HistoryRecorded(
        uint256 indexed batchId,
        uint256 indexed index,
        address indexed actor,
        Action action,
        FarmChainTypes.Stage stage,
        address previousOwner,
        address newOwner,
        string location,
        string metadataCID,
        uint256 timestamp
    );
    event BatchStageUpdated(uint256 indexed batchId, address indexed updatedBy, uint8 stage, uint256 timestamp);
    event TransferInitiated(uint256 indexed batchId, address indexed from, address indexed to, string location, string metadataCID, uint256 timestamp);
    event TransferAccepted(uint256 indexed batchId, address indexed from, address indexed to, uint256 timestamp);
    event BatchTransferred(uint256 indexed batchId, address indexed previousOwner, address indexed newOwner, uint256 timestamp);
    event TransferRejected(uint256 indexed batchId, address indexed from, address indexed to, string reason, uint256 timestamp);
    event TransferCancelled(uint256 indexed batchId, address indexed from, address indexed to, uint256 timestamp);
    event QualityInspectionRecorded(uint256 indexed batchId, address indexed inspector, bool passed, string reportCID, uint256 timestamp);

    error ZeroAddress();
    error NotAdmin();
    error OnlyProductRegistry();
    error BatchNotFound(uint256 batchId);
    error NotBatchOwner(address caller);
    error NotVerified(address account);
    error InvalidTransfer(address from, address to);
    error TransferAlreadyPending(uint256 batchId);
    error NoPendingTransfer(uint256 batchId);
    error NotTransferRecipient(address caller);
    error NotTransferSender(address caller);
    error InvalidStageTransition(FarmChainTypes.Stage current, FarmChainTypes.Stage requested);
    error BatchFinalized(uint256 batchId);
    error RoleNotAllowed(address caller);
    error EmptyField(string field);
    error FieldTooLong(string field);

    modifier onlyRegistry() {
        if (msg.sender != address(productRegistry)) revert OnlyProductRegistry();
        _;
    }

    modifier onlyAdmin() {
        if (!roleManager.isAdmin(msg.sender)) revert NotAdmin();
        _;
    }

    constructor(address roleManager_, address productRegistry_) {
        if (roleManager_ == address(0) || productRegistry_ == address(0)) revert ZeroAddress();
        roleManager = IRoleManager(roleManager_);
        productRegistry = IProductRegistry(productRegistry_);
    }

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Hooks called by ProductRegistry
    // ---------------------------------------------------------------------

    function onBatchRegistered(
        uint256 batchId,
        address farmer,
        uint64 harvestDate,
        string calldata farmLocation,
        string calldata metadataCID
    ) external onlyRegistry {
        _trackParticipant(farmer, batchId);
        // NOTE: the harvest timestamp is declared by the farmer; the chain only proves *who*
        // declared it and *when* it was recorded (the Registered entry).
        _record(batchId, Action.Harvested, FarmChainTypes.Stage.HARVESTED, address(0), farmer, farmer, harvestDate, farmLocation, metadataCID);
        _record(batchId, Action.Registered, FarmChainTypes.Stage.REGISTERED, address(0), farmer, farmer, uint64(block.timestamp), farmLocation, metadataCID);
    }

    function onMetadataUpdated(uint256 batchId, address farmer, string calldata newMetadataCID) external onlyRegistry {
        FarmChainTypes.Stage stage = productRegistry.getBatchStatus(batchId);
        _record(batchId, Action.MetadataUpdated, stage, farmer, farmer, farmer, uint64(block.timestamp), "", newMetadataCID);
    }

    // ---------------------------------------------------------------------
    // Custody transfers
    // ---------------------------------------------------------------------

    /// @notice Offer custody of a batch to another verified participant.
    function initiateTransfer(uint256 batchId, address to, string calldata location, string calldata metadataCID) external whenNotPaused {
        _requireExists(batchId);
        _validateText(location, metadataCID);
        address owner = productRegistry.getBatchOwner(batchId);
        if (owner != msg.sender) revert NotBatchOwner(msg.sender);
        if (_pending[batchId].active) revert TransferAlreadyPending(batchId);
        FarmChainTypes.Stage stage = productRegistry.getBatchStatus(batchId);
        if (_isFinal(stage)) revert BatchFinalized(batchId);
        if (stage == FarmChainTypes.Stage.AT_RETAILER || stage == FarmChainTypes.Stage.AVAILABLE_FOR_SALE) {
            revert InvalidStageTransition(stage, stage);
        }
        if (to == address(0) || to == msg.sender || !_isValidTransfer(msg.sender, to)) revert InvalidTransfer(msg.sender, to);

        _pending[batchId] = PendingTransfer({
            from: msg.sender,
            to: to,
            createdAt: uint64(block.timestamp),
            location: location,
            metadataCID: metadataCID,
            active: true
        });
        _trackParticipant(to, batchId);

        emit TransferInitiated(batchId, msg.sender, to, location, metadataCID, block.timestamp);
        _record(batchId, Action.TransferInitiated, stage, msg.sender, to, msg.sender, uint64(block.timestamp), location, metadataCID);
    }

    /// @notice Recipient explicitly accepts custody. Ownership changes only here.
    function acceptTransfer(uint256 batchId) external whenNotPaused {
        PendingTransfer memory p = _pending[batchId];
        if (!p.active) revert NoPendingTransfer(batchId);
        if (p.to != msg.sender) revert NotTransferRecipient(msg.sender);
        // Re-check permissions: either side may have been revoked since the offer was made.
        if (!_isValidTransfer(p.from, p.to)) revert InvalidTransfer(p.from, p.to);

        delete _pending[batchId];
        productRegistry.setOwner(batchId, msg.sender);
        FarmChainTypes.Stage stage = productRegistry.getBatchStatus(batchId);

        emit TransferAccepted(batchId, p.from, msg.sender, block.timestamp);
        emit BatchTransferred(batchId, p.from, msg.sender, block.timestamp);
        _record(batchId, Action.TransferAccepted, stage, p.from, msg.sender, msg.sender, uint64(block.timestamp), p.location, p.metadataCID);
    }

    /// @notice Recipient declines the offered batch; custody stays with the sender.
    function rejectTransfer(uint256 batchId, string calldata reason) external {
        PendingTransfer memory p = _pending[batchId];
        if (!p.active) revert NoPendingTransfer(batchId);
        if (p.to != msg.sender) revert NotTransferRecipient(msg.sender);
        if (bytes(reason).length > MAX_REASON_LENGTH) revert FieldTooLong("reason");

        delete _pending[batchId];
        FarmChainTypes.Stage stage = productRegistry.getBatchStatus(batchId);
        emit TransferRejected(batchId, p.from, msg.sender, reason, block.timestamp);
        _record(batchId, Action.TransferRejected, stage, p.from, p.from, msg.sender, uint64(block.timestamp), p.location, "");
    }

    /// @notice Sender withdraws an offer that has not yet been accepted.
    function cancelTransfer(uint256 batchId) external {
        PendingTransfer memory p = _pending[batchId];
        if (!p.active) revert NoPendingTransfer(batchId);
        if (p.from != msg.sender) revert NotTransferSender(msg.sender);

        delete _pending[batchId];
        FarmChainTypes.Stage stage = productRegistry.getBatchStatus(batchId);
        emit TransferCancelled(batchId, msg.sender, p.to, block.timestamp);
        _record(batchId, Action.TransferCancelled, stage, msg.sender, msg.sender, msg.sender, uint64(block.timestamp), p.location, "");
    }

    // ---------------------------------------------------------------------
    // Stage events
    // ---------------------------------------------------------------------

    /// @notice Distributor records that the batch has been dispatched / is moving.
    function recordShipment(uint256 batchId, string calldata location, string calldata metadataCID) external whenNotPaused {
        FarmChainTypes.Stage stage = _requireOwnerWithRole(batchId, roleManager.DISTRIBUTOR_ROLE());
        _validateText(location, metadataCID);
        if (bytes(location).length == 0) revert EmptyField("location");
        if (_isRetailOrFinal(stage)) revert InvalidStageTransition(stage, FarmChainTypes.Stage.IN_TRANSIT);
        _setStage(batchId, Action.ShipmentRecorded, FarmChainTypes.Stage.IN_TRANSIT, location, metadataCID);
    }

    /// @notice Warehouse confirms physical arrival and records the storage location/conditions.
    function recordWarehouseArrival(uint256 batchId, string calldata storageLocation, string calldata metadataCID) external whenNotPaused {
        FarmChainTypes.Stage stage = _requireOwnerWithRole(batchId, roleManager.WAREHOUSE_ROLE());
        _validateText(storageLocation, metadataCID);
        if (bytes(storageLocation).length == 0) revert EmptyField("location");
        if (_isRetailOrFinal(stage)) revert InvalidStageTransition(stage, FarmChainTypes.Stage.AT_WAREHOUSE);
        _setStage(batchId, Action.WarehouseArrival, FarmChainTypes.Stage.AT_WAREHOUSE, storageLocation, metadataCID);
    }

    /// @notice Warehouse records a quality inspection (report document on IPFS).
    /// @dev    Records that an inspection *was declared* by a verified warehouse. The blockchain
    ///         cannot itself verify physical product quality.
    function recordQualityInspection(
        uint256 batchId,
        bool passed,
        string calldata location,
        string calldata reportCID
    ) external whenNotPaused {
        FarmChainTypes.Stage stage = _requireOwnerWithRole(batchId, roleManager.WAREHOUSE_ROLE());
        _validateText(location, reportCID);
        if (stage != FarmChainTypes.Stage.AT_WAREHOUSE && stage != FarmChainTypes.Stage.QUALITY_CHECKED) {
            revert InvalidStageTransition(stage, FarmChainTypes.Stage.QUALITY_CHECKED);
        }
        emit QualityInspectionRecorded(batchId, msg.sender, passed, reportCID, block.timestamp);
        _setStage(
            batchId,
            passed ? Action.QualityInspectionPassed : Action.QualityInspectionFailed,
            FarmChainTypes.Stage.QUALITY_CHECKED,
            location,
            reportCID
        );
    }

    /// @notice Retailer confirms the batch arrived at the store.
    function recordRetailArrival(uint256 batchId, string calldata location, string calldata metadataCID) external whenNotPaused {
        FarmChainTypes.Stage stage = _requireOwnerWithRole(batchId, roleManager.RETAILER_ROLE());
        _validateText(location, metadataCID);
        if (bytes(location).length == 0) revert EmptyField("location");
        if (_isRetailOrFinal(stage)) revert InvalidStageTransition(stage, FarmChainTypes.Stage.AT_RETAILER);
        _setStage(batchId, Action.RetailArrival, FarmChainTypes.Stage.AT_RETAILER, location, metadataCID);
    }

    /// @notice Generic stage update for the remaining transitions:
    ///   OUT_FOR_DELIVERY   - owner is a distributor or warehouse (pre-retail stages only)
    ///   AVAILABLE_FOR_SALE - owner is a retailer, current stage AT_RETAILER
    ///   SOLD               - owner is a retailer, current stage AVAILABLE_FOR_SALE
    ///   RECALLED           - admin or original farmer, any stage except RECALLED (cancels pending transfer)
    function updateBatchStatus(
        uint256 batchId,
        FarmChainTypes.Stage newStage,
        string calldata location,
        string calldata metadataCID
    ) external {
        _requireExists(batchId);
        _validateText(location, metadataCID);
        FarmChainTypes.Stage stage = productRegistry.getBatchStatus(batchId);

        if (newStage == FarmChainTypes.Stage.RECALLED) {
            // Recalls stay possible while paused so unsafe produce can always be flagged.
            if (!roleManager.isAdmin(msg.sender) && productRegistry.getBatchFarmer(batchId) != msg.sender) {
                revert RoleNotAllowed(msg.sender);
            }
            if (stage == FarmChainTypes.Stage.RECALLED) revert InvalidStageTransition(stage, newStage);
            if (_pending[batchId].active) {
                PendingTransfer memory p = _pending[batchId];
                delete _pending[batchId];
                emit TransferCancelled(batchId, p.from, p.to, block.timestamp);
            }
            _setStage(batchId, Action.Recalled, newStage, location, metadataCID);
            return;
        }

        _requireNotPaused();
        address owner = productRegistry.getBatchOwner(batchId);
        if (owner != msg.sender) revert NotBatchOwner(msg.sender);
        if (_pending[batchId].active) revert TransferAlreadyPending(batchId);

        if (newStage == FarmChainTypes.Stage.OUT_FOR_DELIVERY) {
            if (!_hasRole(msg.sender, roleManager.DISTRIBUTOR_ROLE()) && !_hasRole(msg.sender, roleManager.WAREHOUSE_ROLE())) {
                revert RoleNotAllowed(msg.sender);
            }
            if (_isRetailOrFinal(stage)) revert InvalidStageTransition(stage, newStage);
            _setStage(batchId, Action.OutForDelivery, newStage, location, metadataCID);
        } else if (newStage == FarmChainTypes.Stage.AVAILABLE_FOR_SALE) {
            if (!_hasRole(msg.sender, roleManager.RETAILER_ROLE())) revert RoleNotAllowed(msg.sender);
            if (stage != FarmChainTypes.Stage.AT_RETAILER) revert InvalidStageTransition(stage, newStage);
            _setStage(batchId, Action.AvailableForSale, newStage, location, metadataCID);
        } else if (newStage == FarmChainTypes.Stage.SOLD) {
            if (!_hasRole(msg.sender, roleManager.RETAILER_ROLE())) revert RoleNotAllowed(msg.sender);
            if (stage != FarmChainTypes.Stage.AVAILABLE_FOR_SALE) revert InvalidStageTransition(stage, newStage);
            _setStage(batchId, Action.Sold, newStage, location, metadataCID);
        } else {
            // Other stages have dedicated functions with their own validation.
            revert InvalidStageTransition(stage, newStage);
        }
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getBatchHistory(uint256 batchId) external view returns (HistoryEntry[] memory) {
        return _history[batchId];
    }

    function getHistoryLength(uint256 batchId) external view returns (uint256) {
        return _history[batchId].length;
    }

    function getHistoryEntry(uint256 batchId, uint256 index) external view returns (HistoryEntry memory) {
        return _history[batchId][index];
    }

    function getPendingTransfer(uint256 batchId) external view returns (PendingTransfer memory) {
        return _pending[batchId];
    }

    function hasPendingTransfer(uint256 batchId) external view returns (bool) {
        return _pending[batchId].active;
    }

    function getParticipantBatches(address participant) external view returns (uint256[] memory) {
        return _participantBatches[participant];
    }

    /// @notice Whether `from` may currently offer custody to `to` (role rules only).
    function canTransfer(address from, address to) external view returns (bool) {
        return from != to && _isValidTransfer(from, to);
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _isValidTransfer(address from, address to) private view returns (bool) {
        bytes32 farmer = roleManager.FARMER_ROLE();
        bytes32 distributor = roleManager.DISTRIBUTOR_ROLE();
        bytes32 warehouse = roleManager.WAREHOUSE_ROLE();
        bytes32 retailer = roleManager.RETAILER_ROLE();

        if (_hasRole(from, farmer) && _hasRole(to, distributor)) return true;
        if (_hasRole(from, distributor) && (_hasRole(to, warehouse) || _hasRole(to, retailer))) return true;
        if (_hasRole(from, warehouse) && (_hasRole(to, retailer) || _hasRole(to, distributor))) return true;
        return false;
    }

    function _hasRole(address account, bytes32 role) private view returns (bool) {
        return roleManager.hasVerifiedRole(account, role);
    }

    function _requireExists(uint256 batchId) private view {
        if (!productRegistry.batchExists(batchId)) revert BatchNotFound(batchId);
    }

    /// @dev Caller must own the batch, hold `role` (verified) and there must be no pending offer.
    function _requireOwnerWithRole(uint256 batchId, bytes32 role) private view returns (FarmChainTypes.Stage) {
        _requireExists(batchId);
        if (productRegistry.getBatchOwner(batchId) != msg.sender) revert NotBatchOwner(msg.sender);
        if (!roleManager.isVerifiedParticipant(msg.sender)) revert NotVerified(msg.sender);
        if (!roleManager.hasRole(role, msg.sender)) revert RoleNotAllowed(msg.sender);
        if (_pending[batchId].active) revert TransferAlreadyPending(batchId);
        return productRegistry.getBatchStatus(batchId);
    }

    function _isFinal(FarmChainTypes.Stage stage) private pure returns (bool) {
        return stage == FarmChainTypes.Stage.SOLD || stage == FarmChainTypes.Stage.RECALLED;
    }

    function _isRetailOrFinal(FarmChainTypes.Stage stage) private pure returns (bool) {
        return
            stage == FarmChainTypes.Stage.AT_RETAILER ||
            stage == FarmChainTypes.Stage.AVAILABLE_FOR_SALE ||
            _isFinal(stage);
    }

    function _validateText(string calldata location, string calldata metadataCID) private pure {
        if (bytes(location).length > MAX_FIELD_LENGTH) revert FieldTooLong("location");
        if (bytes(metadataCID).length > MAX_FIELD_LENGTH) revert FieldTooLong("metadataCID");
    }

    function _setStage(
        uint256 batchId,
        Action action,
        FarmChainTypes.Stage newStage,
        string calldata location,
        string calldata metadataCID
    ) private {
        productRegistry.setStatus(batchId, newStage);
        address owner = productRegistry.getBatchOwner(batchId);
        _record(batchId, action, newStage, owner, owner, msg.sender, uint64(block.timestamp), location, metadataCID);
    }

    function _trackParticipant(address participant, uint256 batchId) private {
        if (!_participantHasBatch[participant][batchId]) {
            _participantHasBatch[participant][batchId] = true;
            _participantBatches[participant].push(batchId);
        }
    }

    function _record(
        uint256 batchId,
        Action action,
        FarmChainTypes.Stage stage,
        address previousOwner,
        address newOwner,
        address actor,
        uint64 timestamp,
        string memory location,
        string memory metadataCID
    ) private {
        HistoryEntry storage e = _history[batchId].push();
        e.batchId = batchId;
        e.action = action;
        e.stage = stage;
        e.previousOwner = previousOwner;
        e.newOwner = newOwner;
        e.actor = actor;
        e.timestamp = timestamp;
        e.location = location;
        e.metadataCID = metadataCID;

        uint256 index = _history[batchId].length - 1;
        emit HistoryRecorded(batchId, index, actor, action, stage, previousOwner, newOwner, location, metadataCID, timestamp);
        emit BatchStageUpdated(batchId, actor, uint8(stage), block.timestamp);
    }
}
