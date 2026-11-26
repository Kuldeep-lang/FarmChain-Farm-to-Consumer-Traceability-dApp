// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title FarmChainTestToken (fUSD)
/// @notice TEST-ONLY ERC-20 used as the escrow payment currency on local Hardhat and Sepolia.
///         It has NO monetary value. Anyone can mint a limited amount from the faucet.
/// @dev    Never deploy this as a payment token on a production network.
contract FarmChainTestToken is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 10_000 ether; // 10,000 fUSD (18 decimals)
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    mapping(address => uint256) public lastFaucetAt;

    error FaucetCooldown(uint256 availableAt);

    constructor(address initialHolder, uint256 initialSupply) ERC20("FarmChain Test USD", "fUSD") {
        _mint(initialHolder, initialSupply);
    }

    /// @notice Mint FAUCET_AMOUNT test tokens to the caller (rate limited per address).
    function faucet() external {
        uint256 last = lastFaucetAt[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) revert FaucetCooldown(last + FAUCET_COOLDOWN);
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
