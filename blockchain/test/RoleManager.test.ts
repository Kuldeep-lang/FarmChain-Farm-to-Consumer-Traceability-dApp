import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployContracts, deployWithParticipants, Role, Verification } from "./fixtures";

describe("RoleManager & UserRegistry", () => {
  describe("participant registration", () => {
    it("registers a farmer with pending verification and no role granted", async () => {
      const { userRegistry, roleManager, farmer } = await loadFixture(deployContracts);
      await expect(userRegistry.connect(farmer).registerUser("Ravi", "Ravi Farms", "Coimbatore", Role.Farmer))
        .to.emit(userRegistry, "UserRegistered")
        .withArgs(farmer.address, Role.Farmer, "Ravi", (ts: bigint) => ts > 0n);

      expect(await userRegistry.isRegistered(farmer.address)).to.equal(true);
      expect(await userRegistry.getUserRole(farmer.address)).to.equal(Role.Farmer);
      const user = await userRegistry.getUser(farmer.address);
      expect(user.name).to.equal("Ravi");
      expect(user.organization).to.equal("Ravi Farms");
      expect(user.verification).to.equal(Verification.Unverified);
      expect(user.roleActive).to.equal(false);
      expect(await roleManager.hasRole(await roleManager.FARMER_ROLE(), farmer.address)).to.equal(false);
      expect(await userRegistry.totalUsers()).to.equal(1n);
    });

    it("rejects duplicate registration, empty fields, None role and over-long fields", async () => {
      const { userRegistry, farmer, outsider } = await loadFixture(deployContracts);
      await userRegistry.connect(farmer).registerUser("Ravi", "", "Coimbatore", Role.Farmer);
      await expect(userRegistry.connect(farmer).registerUser("Ravi", "", "Coimbatore", Role.Farmer))
        .to.be.revertedWithCustomError(userRegistry, "AlreadyRegistered");
      await expect(userRegistry.connect(outsider).registerUser("", "", "X", Role.Farmer))
        .to.be.revertedWithCustomError(userRegistry, "EmptyField");
      await expect(userRegistry.connect(outsider).registerUser("A", "", "", Role.Farmer))
        .to.be.revertedWithCustomError(userRegistry, "EmptyField");
      await expect(userRegistry.connect(outsider).registerUser("A", "", "X", Role.None))
        .to.be.revertedWithCustomError(userRegistry, "InvalidRole");
      await expect(userRegistry.connect(outsider).registerUser("A".repeat(129), "", "X", Role.Farmer))
        .to.be.revertedWithCustomError(userRegistry, "FieldTooLong");
      await expect(userRegistry.connect(outsider).registerUser("A", "B".repeat(129), "X", Role.Farmer))
        .to.be.revertedWithCustomError(userRegistry, "FieldTooLong");
      await expect(userRegistry.connect(outsider).registerUser("A", "B", "X".repeat(129), Role.Farmer))
        .to.be.revertedWithCustomError(userRegistry, "FieldTooLong");
    });

    it("updates profile without changing the requested role", async () => {
      const { userRegistry, farmer, outsider } = await loadFixture(deployContracts);
      await userRegistry.connect(farmer).registerUser("Ravi", "", "Coimbatore", Role.Farmer);
      await expect(userRegistry.connect(farmer).updateUserProfile("Ravi K", "Green Acres", "Pollachi"))
        .to.emit(userRegistry, "UserProfileUpdated");
      const user = await userRegistry.getUser(farmer.address);
      expect(user.name).to.equal("Ravi K");
      expect(user.location).to.equal("Pollachi");
      expect(user.role).to.equal(Role.Farmer);
      await expect(userRegistry.connect(outsider).updateUserProfile("x", "", "y"))
        .to.be.revertedWithCustomError(userRegistry, "NotRegistered");
      await expect(userRegistry.getUser(outsider.address)).to.be.revertedWithCustomError(userRegistry, "NotRegistered");
    });

    it("paginates registered users", async () => {
      const { userRegistry, farmer, distributor, warehouse } = await loadFixture(deployContracts);
      await userRegistry.connect(farmer).registerUser("A", "", "X", Role.Farmer);
      await userRegistry.connect(distributor).registerUser("B", "", "X", Role.Distributor);
      await userRegistry.connect(warehouse).registerUser("C", "", "X", Role.Warehouse);
      expect(await userRegistry.getUsers(0, 2)).to.deep.equal([farmer.address, distributor.address]);
      expect(await userRegistry.getUsers(2, 10)).to.deep.equal([warehouse.address]);
      expect(await userRegistry.getUsers(5, 10)).to.deep.equal([]);
    });
  });

  describe("administrative verification", () => {
    it("admin verifies a participant and grants exactly the requested role", async () => {
      const { userRegistry, roleManager, admin, distributor } = await loadFixture(deployContracts);
      await userRegistry.connect(distributor).registerUser("Kovai", "", "Coimbatore", Role.Distributor);
      const role = await roleManager.DISTRIBUTOR_ROLE();
      await expect(roleManager.verifyParticipant(distributor.address))
        .to.emit(roleManager, "ParticipantVerified")
        .withArgs(distributor.address, role, admin.address, (t: bigint) => t > 0n);
      expect(await roleManager.isVerifiedParticipant(distributor.address)).to.equal(true);
      expect(await roleManager.hasVerifiedRole(distributor.address, role)).to.equal(true);
      expect(await roleManager.hasRole(await roleManager.FARMER_ROLE(), distributor.address)).to.equal(false);
      expect(await roleManager.verifiedAt(distributor.address)).to.be.gt(0n);
      expect((await userRegistry.getUser(distributor.address)).roleActive).to.equal(true);
      await expect(roleManager.verifyParticipant(distributor.address))
        .to.be.revertedWithCustomError(roleManager, "AlreadyVerified");
    });

    it("rejects verification of unregistered wallets", async () => {
      const { roleManager, outsider } = await loadFixture(deployContracts);
      await expect(roleManager.verifyParticipant(outsider.address)).to.be.revertedWithCustomError(roleManager, "NotRegistered");
      await expect(roleManager.rejectParticipant(outsider.address, "x")).to.be.revertedWithCustomError(roleManager, "NotRegistered");
    });

    it("non-admins cannot verify, reject, revoke or grant roles", async () => {
      const { userRegistry, roleManager, farmer, outsider } = await loadFixture(deployContracts);
      await userRegistry.connect(farmer).registerUser("Ravi", "", "X", Role.Farmer);
      const farmerRole = await roleManager.FARMER_ROLE();
      await expect(roleManager.connect(farmer).verifyParticipant(farmer.address))
        .to.be.revertedWithCustomError(roleManager, "AccessControlUnauthorizedAccount");
      await expect(roleManager.connect(outsider).rejectParticipant(farmer.address, "no"))
        .to.be.revertedWithCustomError(roleManager, "AccessControlUnauthorizedAccount");
      await expect(roleManager.connect(outsider).revokeVerification(farmer.address, "no"))
        .to.be.revertedWithCustomError(roleManager, "AccessControlUnauthorizedAccount");
      await expect(roleManager.connect(farmer).grantParticipantRole(farmer.address, farmerRole))
        .to.be.revertedWithCustomError(roleManager, "AccessControlUnauthorizedAccount");
      await expect(roleManager.connect(farmer).revokeParticipantRole(farmer.address, farmerRole))
        .to.be.revertedWithCustomError(roleManager, "AccessControlUnauthorizedAccount");
      await expect(roleManager.connect(farmer).setUserRegistry(outsider.address))
        .to.be.revertedWithCustomError(roleManager, "AccessControlUnauthorizedAccount");
    });

    it("prevents unauthorized role assignment, including self-assigning admin", async () => {
      const { roleManager, farmer } = await loadFixture(deployContracts);
      const adminRole = await roleManager.DEFAULT_ADMIN_ROLE();
      await expect(roleManager.connect(farmer).grantRole(adminRole, farmer.address))
        .to.be.revertedWithCustomError(roleManager, "AccessControlUnauthorizedAccount");
      await expect(roleManager.connect(farmer).grantRole(await roleManager.FARMER_ROLE(), farmer.address))
        .to.be.revertedWithCustomError(roleManager, "UseParticipantRoleFunctions");
      expect(await roleManager.isAdmin(farmer.address)).to.equal(false);
    });

    it("blocks participant roles via generic grantRole/revokeRole even for admin", async () => {
      const { roleManager, farmer, outsider } = await loadFixture(deployContracts);
      const farmerRole = await roleManager.FARMER_ROLE();
      await expect(roleManager.grantRole(farmerRole, farmer.address))
        .to.be.revertedWithCustomError(roleManager, "UseParticipantRoleFunctions");
      await expect(roleManager.revokeRole(farmerRole, farmer.address))
        .to.be.revertedWithCustomError(roleManager, "UseParticipantRoleFunctions");
      // Admin role still manageable through standard AccessControl.
      const adminRole = await roleManager.DEFAULT_ADMIN_ROLE();
      await roleManager.grantRole(adminRole, outsider.address);
      expect(await roleManager.isAdmin(outsider.address)).to.equal(true);
      await roleManager.revokeRole(adminRole, outsider.address);
      expect(await roleManager.isAdmin(outsider.address)).to.equal(false);
    });

    it("rejects a pending registration", async () => {
      const { userRegistry, roleManager, admin, farmer } = await loadFixture(deployContracts);
      await userRegistry.connect(farmer).registerUser("Ravi", "", "X", Role.Farmer);
      await expect(roleManager.rejectParticipant(farmer.address, "Incomplete documents"))
        .to.emit(roleManager, "ParticipantRejected")
        .withArgs(farmer.address, admin.address, "Incomplete documents", (t: bigint) => t > 0n);
      expect(await roleManager.verificationStatus(farmer.address)).to.equal(Verification.Rejected);
      expect(await roleManager.isVerifiedParticipant(farmer.address)).to.equal(false);
      await expect(roleManager.rejectParticipant(farmer.address, "x".repeat(257)))
        .to.be.revertedWithCustomError(roleManager, "ReasonTooLong");
      // A rejected participant can later be approved.
      await roleManager.verifyParticipant(farmer.address);
      await expect(roleManager.rejectParticipant(farmer.address, "late"))
        .to.be.revertedWithCustomError(roleManager, "AlreadyVerified");
    });

    it("revokes verification and strips all participant roles", async () => {
      const { userRegistry, roleManager, farmer } = await loadFixture(deployContracts);
      await userRegistry.connect(farmer).registerUser("Ravi", "", "X", Role.Farmer);
      await roleManager.verifyParticipant(farmer.address);
      await roleManager.grantParticipantRole(farmer.address, await roleManager.RETAILER_ROLE());
      await expect(roleManager.revokeVerification(farmer.address, "x".repeat(257)))
        .to.be.revertedWithCustomError(roleManager, "ReasonTooLong");
      await expect(roleManager.revokeVerification(farmer.address, "Fraud"))
        .to.emit(roleManager, "VerificationRevoked");
      expect(await roleManager.verificationStatus(farmer.address)).to.equal(Verification.Revoked);
      expect(await roleManager.hasRole(await roleManager.FARMER_ROLE(), farmer.address)).to.equal(false);
      expect(await roleManager.hasRole(await roleManager.RETAILER_ROLE(), farmer.address)).to.equal(false);
      await expect(roleManager.revokeVerification(farmer.address, "again"))
        .to.be.revertedWithCustomError(roleManager, "NotVerified");
    });

    it("grantParticipantRole only works for verified participants and participant roles", async () => {
      const { userRegistry, roleManager, farmer, outsider } = await loadFixture(deployContracts);
      const retailerRole = await roleManager.RETAILER_ROLE();
      await expect(roleManager.grantParticipantRole(outsider.address, retailerRole))
        .to.be.revertedWithCustomError(roleManager, "NotVerified");
      await expect(roleManager.grantParticipantRole(outsider.address, await roleManager.DEFAULT_ADMIN_ROLE()))
        .to.be.revertedWithCustomError(roleManager, "NotParticipantRole");
      await expect(roleManager.revokeParticipantRole(outsider.address, ethers.ZeroHash))
        .to.be.revertedWithCustomError(roleManager, "NotParticipantRole");
      await userRegistry.connect(farmer).registerUser("Ravi", "", "X", Role.Farmer);
      await roleManager.verifyParticipant(farmer.address);
      await expect(roleManager.grantParticipantRole(farmer.address, retailerRole)).to.emit(roleManager, "ParticipantRoleGranted");
      expect(await roleManager.hasVerifiedRole(farmer.address, retailerRole)).to.equal(true);
      await expect(roleManager.revokeParticipantRole(farmer.address, retailerRole)).to.emit(roleManager, "ParticipantRoleRevoked");
      expect(await roleManager.hasVerifiedRole(farmer.address, retailerRole)).to.equal(false);
    });

    it("getUser reports an active role for every verified participant category", async () => {
      const { userRegistry, farmer, distributor, warehouse, retailer } = await loadFixture(deployWithParticipants);
      for (const s of [farmer, distributor, warehouse, retailer]) {
        const u = await userRegistry.getUser(s.address);
        expect(u.verification).to.equal(Verification.Verified);
        expect(u.roleActive).to.equal(true);
      }
    });

    it("configuration guards", async () => {
      const { roleManager, outsider } = await loadFixture(deployContracts);
      await expect(roleManager.setUserRegistry(outsider.address)).to.be.revertedWithCustomError(roleManager, "UserRegistryAlreadySet");
      const fresh = await ethers.deployContract("RoleManager", [outsider.address]);
      await expect(fresh.connect(outsider).setUserRegistry(ethers.ZeroAddress)).to.be.revertedWithCustomError(fresh, "ZeroAddress");
      await expect(fresh.connect(outsider).verifyParticipant(outsider.address)).to.be.revertedWithCustomError(fresh, "UserRegistryNotSet");
      await expect(fresh.connect(outsider).rejectParticipant(outsider.address, "")).to.be.revertedWithCustomError(fresh, "UserRegistryNotSet");
      await expect(ethers.deployContract("RoleManager", [ethers.ZeroAddress])).to.be.revertedWithCustomError(fresh, "ZeroAddress");
      await expect(ethers.deployContract("UserRegistry", [ethers.ZeroAddress])).to.be.reverted;
      await expect(fresh.roleFor(Role.None)).to.be.revertedWithCustomError(fresh, "NotParticipantRole");
      expect(await fresh.roleFor(Role.Warehouse)).to.equal(await fresh.WAREHOUSE_ROLE());
    });
  });
});
