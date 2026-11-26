// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FarmChainTypes
/// @notice Shared enums used by every FarmChain contract so that all contracts agree on
///         role identifiers, supply-chain stages and verification states.
library FarmChainTypes {
    /// @dev Participant category a wallet *requests* at registration. Requesting a role grants
    ///      nothing: only an administrator can grant the matching AccessControl role (RoleManager).
    enum Role {
        None,
        Farmer,
        Distributor,
        Warehouse,
        Retailer
    }

    /// @dev Supply-chain stages (spec numbering 1..10 maps to enum values 0..9).
    enum Stage {
        HARVESTED,
        REGISTERED,
        IN_TRANSIT,
        AT_WAREHOUSE,
        QUALITY_CHECKED,
        OUT_FOR_DELIVERY,
        AT_RETAILER,
        AVAILABLE_FOR_SALE,
        SOLD,
        RECALLED
    }

    enum VerificationStatus {
        Unverified, // not yet reviewed by an admin ("pending" when the wallet is registered)
        Verified,
        Rejected,
        Revoked
    }
}
