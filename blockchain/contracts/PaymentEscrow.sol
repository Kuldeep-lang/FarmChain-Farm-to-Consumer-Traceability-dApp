// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {FarmChainTypes} from "./libraries/FarmChainTypes.sol";
import {IRoleManager} from "./interfaces/IRoleManager.sol";
import {IProductRegistry} from "./interfaces/IProductRegistry.sol";

/// @title PaymentEscrow
/// @notice ERC-20 escrow between supply-chain participants for a specific batch.
/// @dev Workflow:
///   1. Buyer `createOrder` (seller must be the batch's current owner).
///   2. Buyer `depositPayment` (tokens move into escrow; delivery deadline starts).
///   3. Seller dispatches the batch through SupplyChainTracker.
///   4. Buyer `confirmDelivery` -> funds released to seller in the same transaction.
///      Alternatively anyone party to the order may call `releasePayment` once the buyer has
///      accepted custody on-chain (ProductRegistry owner == buyer), which is on-chain proof of
///      delivery and protects sellers from unresponsive buyers.
///
/// Refund / timeout rules:
///   - The seller may refund a funded order at any time (`requestRefund` called by seller).
///   - The buyer may reclaim funds with `requestRefund` only after `deliveryDeadline` has passed
///     AND the buyer has not taken custody of the batch on-chain.
///   - Unfunded orders can be cancelled by either party (`cancelOrder`).
///
/// There is deliberately NO admin withdrawal function: escrowed tokens can only ever go to the
/// order's seller (release) or buyer (refund). Pausing only blocks new orders and deposits;
/// releases and refunds keep working so funds can never be frozen by the admin.
contract PaymentEscrow is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    enum OrderStatus {
        Created,
        Funded,
        Released,
        Refunded,
        Cancelled
    }

    struct Order {
        uint256 id;
        uint256 batchId;
        address buyer;
        address seller;
        uint256 amount;
        uint64 createdAt;
        uint64 fundedAt;
        uint64 deliveryWindow;
        uint64 deliveryDeadline;
        uint64 deliveredAt;
        OrderStatus status;
        bool deliveryConfirmed;
    }

    uint64 public constant MIN_DELIVERY_WINDOW = 1 hours;
    uint64 public constant MAX_DELIVERY_WINDOW = 180 days;

    IERC20 public immutable paymentToken;
    IRoleManager public immutable roleManager;
    IProductRegistry public immutable productRegistry;

    uint256 public nextOrderId = 1;
    mapping(uint256 => Order) private _orders;
    mapping(address => uint256[]) private _userOrders;
    mapping(uint256 => uint256[]) private _batchOrders;
    /// @dev At most one open (Created/Funded) order per batch: prevents paying twice for one batch.
    mapping(uint256 => uint256) public activeOrderForBatch;

    event OrderCreated(uint256 indexed orderId, uint256 indexed batchId, address indexed buyer, address seller, uint256 amount, uint64 deliveryWindow, uint256 timestamp);
    event PaymentDeposited(uint256 indexed orderId, uint256 indexed batchId, address indexed buyer, uint256 amount, uint64 deliveryDeadline, uint256 timestamp);
    event DeliveryConfirmed(uint256 indexed orderId, uint256 indexed batchId, address indexed confirmedBy, bool onChainCustody, uint256 timestamp);
    event PaymentReleased(uint256 indexed orderId, uint256 indexed batchId, address indexed seller, uint256 amount, uint256 timestamp);
    event PaymentRefunded(uint256 indexed orderId, uint256 indexed batchId, address indexed buyer, uint256 amount, address requestedBy, uint256 timestamp);
    event OrderCancelled(uint256 indexed orderId, uint256 indexed batchId, address indexed cancelledBy, uint256 timestamp);

    error ZeroAddress();
    error NotAdmin();
    error NotVerified(address account);
    error OrderNotFound(uint256 orderId);
    error InvalidAmount();
    error InvalidDeliveryWindow();
    error InvalidSeller();
    error BatchNotFound(uint256 batchId);
    error BatchNotPurchasable(uint256 batchId);
    error ActiveOrderExists(uint256 batchId, uint256 orderId);
    error InvalidOrderStatus(OrderStatus current);
    error NotBuyer();
    error NotOrderParty();
    error DeliveryNotProven();
    error RefundNotAvailable();

    modifier onlyAdmin() {
        if (!roleManager.isAdmin(msg.sender)) revert NotAdmin();
        _;
    }

    constructor(address token_, address roleManager_, address productRegistry_) {
        if (token_ == address(0) || roleManager_ == address(0) || productRegistry_ == address(0)) revert ZeroAddress();
        paymentToken = IERC20(token_);
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
    // Order lifecycle
    // ---------------------------------------------------------------------

    function createOrder(uint256 batchId, address seller, uint256 amount, uint64 deliveryWindow) external whenNotPaused returns (uint256 orderId) {
        if (!roleManager.isVerifiedParticipant(msg.sender)) revert NotVerified(msg.sender);
        if (!roleManager.isVerifiedParticipant(seller)) revert NotVerified(seller);
        if (seller == msg.sender || seller == address(0)) revert InvalidSeller();
        if (amount == 0) revert InvalidAmount();
        if (deliveryWindow < MIN_DELIVERY_WINDOW || deliveryWindow > MAX_DELIVERY_WINDOW) revert InvalidDeliveryWindow();
        if (!productRegistry.batchExists(batchId)) revert BatchNotFound(batchId);
        if (productRegistry.getBatchOwner(batchId) != seller) revert InvalidSeller();
        FarmChainTypes.Stage stage = productRegistry.getBatchStatus(batchId);
        if (stage == FarmChainTypes.Stage.SOLD || stage == FarmChainTypes.Stage.RECALLED) revert BatchNotPurchasable(batchId);
        uint256 existing = activeOrderForBatch[batchId];
        if (existing != 0) revert ActiveOrderExists(batchId, existing);

        orderId = nextOrderId++;
        _orders[orderId] = Order({
            id: orderId,
            batchId: batchId,
            buyer: msg.sender,
            seller: seller,
            amount: amount,
            createdAt: uint64(block.timestamp),
            fundedAt: 0,
            deliveryWindow: deliveryWindow,
            deliveryDeadline: 0,
            deliveredAt: 0,
            status: OrderStatus.Created,
            deliveryConfirmed: false
        });
        activeOrderForBatch[batchId] = orderId;
        _userOrders[msg.sender].push(orderId);
        _userOrders[seller].push(orderId);
        _batchOrders[batchId].push(orderId);

        emit OrderCreated(orderId, batchId, msg.sender, seller, amount, deliveryWindow, block.timestamp);
    }

    /// @notice Buyer funds the order. Requires prior ERC-20 approval of `amount`.
    function depositPayment(uint256 orderId) external nonReentrant whenNotPaused {
        Order storage o = _getOrder(orderId);
        if (o.buyer != msg.sender) revert NotBuyer();
        // Status check makes a second deposit impossible (double-payment protection).
        if (o.status != OrderStatus.Created) revert InvalidOrderStatus(o.status);

        // Effects before interaction (checks-effects-interactions).
        o.status = OrderStatus.Funded;
        o.fundedAt = uint64(block.timestamp);
        o.deliveryDeadline = uint64(block.timestamp) + o.deliveryWindow;

        paymentToken.safeTransferFrom(msg.sender, address(this), o.amount);
        emit PaymentDeposited(orderId, o.batchId, msg.sender, o.amount, o.deliveryDeadline, block.timestamp);
    }

    /// @notice Buyer confirms the goods arrived; funds are released to the seller immediately.
    function confirmDelivery(uint256 orderId) external nonReentrant {
        Order storage o = _getOrder(orderId);
        if (o.buyer != msg.sender) revert NotBuyer();
        if (o.status != OrderStatus.Funded) revert InvalidOrderStatus(o.status);

        o.deliveryConfirmed = true;
        o.deliveredAt = uint64(block.timestamp);
        emit DeliveryConfirmed(orderId, o.batchId, msg.sender, false, block.timestamp);
        _release(o);
    }

    /// @notice Release funds based on on-chain proof of delivery: the buyer has accepted custody
    ///         of the batch in SupplyChainTracker. Callable by buyer or seller.
    function releasePayment(uint256 orderId) external nonReentrant {
        Order storage o = _getOrder(orderId);
        if (msg.sender != o.buyer && msg.sender != o.seller) revert NotOrderParty();
        if (o.status != OrderStatus.Funded) revert InvalidOrderStatus(o.status);
        if (productRegistry.getBatchOwner(o.batchId) != o.buyer) revert DeliveryNotProven();

        o.deliveryConfirmed = true;
        o.deliveredAt = uint64(block.timestamp);
        emit DeliveryConfirmed(orderId, o.batchId, msg.sender, true, block.timestamp);
        _release(o);
    }

    /// @notice Refund a funded order (see refund rules in the contract docs).
    function requestRefund(uint256 orderId) external nonReentrant {
        Order storage o = _getOrder(orderId);
        if (o.status != OrderStatus.Funded) revert InvalidOrderStatus(o.status);

        if (msg.sender == o.seller) {
            // Seller-agreed refund: always allowed.
        } else if (msg.sender == o.buyer) {
            bool deadlinePassed = block.timestamp > o.deliveryDeadline;
            bool buyerHasCustody = productRegistry.getBatchOwner(o.batchId) == o.buyer;
            if (!deadlinePassed || buyerHasCustody) revert RefundNotAvailable();
        } else {
            revert NotOrderParty();
        }

        o.status = OrderStatus.Refunded;
        _clearActive(o);
        paymentToken.safeTransfer(o.buyer, o.amount);
        emit PaymentRefunded(orderId, o.batchId, o.buyer, o.amount, msg.sender, block.timestamp);
    }

    /// @notice Cancel an order that has not been funded yet.
    function cancelOrder(uint256 orderId) external {
        Order storage o = _getOrder(orderId);
        if (msg.sender != o.buyer && msg.sender != o.seller) revert NotOrderParty();
        if (o.status != OrderStatus.Created) revert InvalidOrderStatus(o.status);

        o.status = OrderStatus.Cancelled;
        _clearActive(o);
        emit OrderCancelled(orderId, o.batchId, msg.sender, block.timestamp);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getOrderDetails(uint256 orderId) external view returns (Order memory) {
        if (_orders[orderId].id == 0) revert OrderNotFound(orderId);
        return _orders[orderId];
    }

    function getUserOrders(address account) external view returns (uint256[] memory) {
        return _userOrders[account];
    }

    function getBatchOrders(uint256 batchId) external view returns (uint256[] memory) {
        return _batchOrders[batchId];
    }

    function totalOrders() external view returns (uint256) {
        return nextOrderId - 1;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _getOrder(uint256 orderId) private view returns (Order storage o) {
        o = _orders[orderId];
        if (o.id == 0) revert OrderNotFound(orderId);
    }

    function _clearActive(Order storage o) private {
        if (activeOrderForBatch[o.batchId] == o.id) activeOrderForBatch[o.batchId] = 0;
    }

    function _release(Order storage o) private {
        o.status = OrderStatus.Released;
        _clearActive(o);
        paymentToken.safeTransfer(o.seller, o.amount);
        emit PaymentReleased(o.id, o.batchId, o.seller, o.amount, block.timestamp);
    }
}
