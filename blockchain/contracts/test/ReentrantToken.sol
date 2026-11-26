// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IEscrowLike {
    function requestRefund(uint256 orderId) external;
    function confirmDelivery(uint256 orderId) external;
}

/// @dev TEST MOCK. An ERC-20 that tries to re-enter the escrow during `transfer`, used to prove
///      that PaymentEscrow's ReentrancyGuard blocks double withdrawals.
contract ReentrantToken is ERC20 {
    address public escrow;
    uint256 public targetOrder;
    bool public attackEnabled;
    bool public attackSucceeded;

    constructor() ERC20("Reentrant", "REE") {
        _mint(msg.sender, 1_000_000 ether);
    }

    function arm(address escrow_, uint256 orderId) external {
        escrow = escrow_;
        targetOrder = orderId;
        attackEnabled = true;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        bool ok = super.transfer(to, value);
        if (attackEnabled && msg.sender == escrow) {
            attackEnabled = false;
            // Attempt to re-enter; must revert because of nonReentrant.
            try IEscrowLike(escrow).requestRefund(targetOrder) {
                attackSucceeded = true;
            } catch {}
        }
        return ok;
    }
}
