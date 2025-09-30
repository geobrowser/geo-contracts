import {
  SpaceRegistry,
  SpaceRegistry__factory,
  MockDAOFactory,
  MockDAOFactory__factory,
  DAOFactory,
} from '../../typechain';
import {deployWithProxy} from '../../utils/helpers';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {expect} from 'chai';
import {ethers} from 'hardhat';

const ZERO_ADDRESS = ethers.constants.AddressZero;
const EMPTY_BYTES16 = '0x00000000000000000000000000000000';

describe('SpaceRegistry', function () {
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let mockDAOFactory: MockDAOFactory;
  let spaceRegistry: SpaceRegistry;

  const daoSettings: DAOFactory.DAOSettingsStruct = {
    daoURI: 'ipfs://',
    subdomain: 'test',
    trustedForwarder: ZERO_ADDRESS,
    metadata: '0x',
  };

  const pluginSettings: DAOFactory.PluginSettingsStruct[] = [];

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();
    mockDAOFactory = await new MockDAOFactory__factory(owner).deploy();
    spaceRegistry = await deployWithProxy<SpaceRegistry>(
      new SpaceRegistry__factory(owner)
    );
    await spaceRegistry.initialize(owner.address, mockDAOFactory.address);
  });

  describe('Initialization', () => {
    it('should initialize correctly', async () => {
      expect(await spaceRegistry.owner()).to.equal(owner.address);
      expect(await spaceRegistry.daoFactory()).to.equal(mockDAOFactory.address);
    });

    it('should revert if initialized with zero address for daoFactory', async () => {
      const newSpaceRegistry = await deployWithProxy<SpaceRegistry>(
        new SpaceRegistry__factory(owner)
      );
      await expect(
        newSpaceRegistry.initialize(owner.address, ZERO_ADDRESS)
      ).to.be.revertedWithCustomError(
        spaceRegistry,
        'SpaceRegistryInvalidZeroAddress'
      );
    });

    it('should revert on re-initialization', async () => {
      await expect(
        spaceRegistry.initialize(owner.address, mockDAOFactory.address)
      ).to.be.revertedWith('Initializable: contract is already initialized');
    });
  });

  describe('Space Creation', () => {
    it('should create a space', async () => {
      const tx = await spaceRegistry
        .connect(alice)
        .createSpace(daoSettings, pluginSettings, false);

      const createdDaoAddr = await mockDAOFactory.createdDAOs(0);
      const spaceId = await spaceRegistry.generateSpaceId(createdDaoAddr);

      expect(await spaceRegistry.daoAddressBySpaceId(spaceId)).to.equal(
        createdDaoAddr
      );
      expect(await spaceRegistry.spacesByDAOAddress(createdDaoAddr)).to.equal(
        spaceId
      );

      await expect(tx)
        .to.emit(spaceRegistry, 'SpaceRegistrySpaceCreated')
        .withArgs(spaceId, createdDaoAddr, alice.address);
    });

    it('should create a home space', async () => {
      const tx = await spaceRegistry
        .connect(alice)
        .createSpace(daoSettings, pluginSettings, true);

      const createdDaoAddr = await mockDAOFactory.createdDAOs(0);
      const spaceId = await spaceRegistry.generateSpaceId(createdDaoAddr);

      expect(await spaceRegistry.homeSpaceByAddress(alice.address)).to.equal(
        spaceId
      );

      await expect(tx)
        .to.emit(spaceRegistry, 'SpaceRegistryHomeSpaceSet')
        .withArgs(alice.address, EMPTY_BYTES16, spaceId);
    });
  });

  describe('Home Space Management', () => {
    let aliceSpaceId: string;
    let aliceDaoAddress: string;

    beforeEach(async () => {
      await spaceRegistry
        .connect(alice)
        .createSpace(daoSettings, pluginSettings, true);

      aliceDaoAddress = await mockDAOFactory.createdDAOs(0);
      aliceSpaceId = await spaceRegistry.generateSpaceId(aliceDaoAddress);
    });

    it('should allow a user to request to set a home space', async () => {
      await expect(spaceRegistry.connect(bob).setHomeSpace(aliceSpaceId))
        .to.emit(spaceRegistry, 'SpaceRegistryHomeSpaceUpdatePending')
        .withArgs(bob.address, aliceSpaceId, aliceDaoAddress);

      expect(await spaceRegistry.pendingHomeSpaceId(bob.address)).to.equal(
        aliceSpaceId
      );
    });

    it('should revert when setting a home space with an invalid spaceId', async () => {
      // This does not correlate to a space that was created so
      // it should revert
      const invalidSpaceId = ethers.utils
        .formatBytes32String('invalid')
        .slice(0, 34);
      await expect(spaceRegistry.connect(bob).setHomeSpace(invalidSpaceId))
        .to.be.revertedWithCustomError(
          spaceRegistry,
          'SpaceRegistryInvalidSpaceId'
        )
        .withArgs(invalidSpaceId);
    });

    it('should allow the DAO to accept the home space request', async () => {
      await spaceRegistry.connect(bob).setHomeSpace(aliceSpaceId);

      // We need to impersonate the DAO to call `acceptHomeSpace`
      await ethers.provider.send('hardhat_impersonateAccount', [
        aliceDaoAddress,
      ]);
      const daoSigner = await ethers.getSigner(aliceDaoAddress);
      await owner.sendTransaction({
        to: daoSigner.address,
        value: ethers.utils.parseEther('1'),
      }); // Give it some gas money

      const previousHomeSpace = await spaceRegistry.homeSpaceByAddress(
        bob.address
      );

      await expect(
        spaceRegistry.connect(daoSigner).acceptHomeSpace(bob.address)
      )
        .to.emit(spaceRegistry, 'SpaceRegistryHomeSpaceSet')
        .withArgs(bob.address, previousHomeSpace, aliceSpaceId);

      expect(await spaceRegistry.homeSpaceByAddress(bob.address)).to.equal(
        aliceSpaceId
      );
      expect(await spaceRegistry.pendingHomeSpaceId(bob.address)).to.equal(
        EMPTY_BYTES16
      );

      await ethers.provider.send('hardhat_stopImpersonatingAccount', [
        aliceDaoAddress,
      ]);
    });

    it('should revert if a non-DAO address tries to accept the home space request', async () => {
      await spaceRegistry.connect(bob).setHomeSpace(aliceSpaceId);

      await expect(spaceRegistry.connect(alice).acceptHomeSpace(bob.address))
        .to.be.revertedWithCustomError(
          spaceRegistry,
          'SpaceRegistryInvalidCaller'
        )
        .withArgs(alice.address);
    });
  });

  describe('Owner-only functions', () => {
    it('should allow the owner to create a space with a specific ID', async () => {
      const spaceId = ethers.utils
        .formatBytes32String('my-custom-space')
        .slice(0, 34);
      const tx = await spaceRegistry
        .connect(owner)
        .createSpaceWithId(daoSettings, pluginSettings, spaceId);

      const createdDaoAddr = await mockDAOFactory.createdDAOs(0);

      expect(await spaceRegistry.daoAddressBySpaceId(spaceId)).to.equal(
        createdDaoAddr
      );
      expect(await spaceRegistry.spacesByDAOAddress(createdDaoAddr)).to.equal(
        spaceId
      );

      await expect(tx)
        .to.emit(spaceRegistry, 'SpaceRegistrySpaceCreated')
        .withArgs(spaceId, createdDaoAddr, owner.address);
    });

    it('should revert if a non-owner tries to create a space with a specific ID', async () => {
      const spaceId = ethers.utils
        .formatBytes32String('my-custom-space')
        .slice(0, 34);
      await expect(
        spaceRegistry
          .connect(alice)
          .createSpaceWithId(daoSettings, pluginSettings, spaceId)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('Edge Cases', () => {
    it('should revert when creating a space with an already existing space ID', async () => {
      // First create a space with a custom ID
      const existingSpaceId = ethers.utils
        .formatBytes32String('existing')
        .slice(0, 34);
      await spaceRegistry
        .connect(owner)
        .createSpaceWithId(daoSettings, pluginSettings, existingSpaceId);

      // Try to create another space with the same ID
      await expect(
        spaceRegistry
          .connect(owner)
          .createSpaceWithId(daoSettings, pluginSettings, existingSpaceId)
      )
        .to.be.revertedWithCustomError(
          spaceRegistry,
          'SpaceRegistrySpaceIdAlreadyExists'
        )
        .withArgs(existingSpaceId);
    });

    it('should revert when accepting home space with no pending request', async () => {
      // Create a space
      await spaceRegistry
        .connect(alice)
        .createSpace(daoSettings, pluginSettings, false);

      const daoAddress = await mockDAOFactory.createdDAOs(0);

      // Impersonate the DAO
      await ethers.provider.send('hardhat_impersonateAccount', [daoAddress]);
      const daoSigner = await ethers.getSigner(daoAddress);
      await owner.sendTransaction({
        to: daoSigner.address,
        value: ethers.utils.parseEther('1'),
      });

      // Try to accept home space without a pending request
      await expect(
        spaceRegistry.connect(daoSigner).acceptHomeSpace(bob.address)
      )
        .to.be.revertedWithCustomError(
          spaceRegistry,
          'SpaceRegistryNoPendingRequest'
        )
        .withArgs(bob.address);

      await ethers.provider.send('hardhat_stopImpersonatingAccount', [
        daoAddress,
      ]);
    });

    it('should revert when trying to set current home space as home space', async () => {
      // Create a home space for alice
      await spaceRegistry
        .connect(alice)
        .createSpace(daoSettings, pluginSettings, true);

      const aliceDaoAddress = await mockDAOFactory.createdDAOs(0);
      const aliceSpaceId = await spaceRegistry.generateSpaceId(aliceDaoAddress);

      // Try to set the same space as home space again
      await expect(spaceRegistry.connect(alice).setHomeSpace(aliceSpaceId))
        .to.be.revertedWithCustomError(
          spaceRegistry,
          'SpaceRegistryAlreadyHomeSpace'
        )
        .withArgs(aliceSpaceId);
    });

    it('should handle space migration with pending home space requests', async () => {
      // Create a space
      await spaceRegistry
        .connect(alice)
        .createSpace(daoSettings, pluginSettings, false);

      const oldDaoAddress = await mockDAOFactory.createdDAOs(0);
      const spaceId = await spaceRegistry.generateSpaceId(oldDaoAddress);

      // Bob requests this space as home space
      await spaceRegistry.connect(bob).setHomeSpace(spaceId);

      // Verify pending request exists
      expect(await spaceRegistry.pendingHomeSpaceId(bob.address)).to.equal(
        spaceId
      );

      // Migrate the space
      await ethers.provider.send('hardhat_impersonateAccount', [oldDaoAddress]);
      const daoSigner = await ethers.getSigner(oldDaoAddress);
      await owner.sendTransaction({
        to: daoSigner.address,
        value: ethers.utils.parseEther('1'),
      });

      await spaceRegistry
        .connect(daoSigner)
        .migrateSpace(daoSettings, pluginSettings);

      const newDaoAddress = await mockDAOFactory.createdDAOs(1);

      // Pending request should still exist with same space ID
      expect(await spaceRegistry.pendingHomeSpaceId(bob.address)).to.equal(
        spaceId
      );

      // New DAO should be able to accept the pending request
      await ethers.provider.send('hardhat_stopImpersonatingAccount', [
        oldDaoAddress,
      ]);
      await ethers.provider.send('hardhat_impersonateAccount', [newDaoAddress]);
      const newDaoSigner = await ethers.getSigner(newDaoAddress);
      await owner.sendTransaction({
        to: newDaoSigner.address,
        value: ethers.utils.parseEther('1'),
      });

      await expect(
        spaceRegistry.connect(newDaoSigner).acceptHomeSpace(bob.address)
      )
        .to.emit(spaceRegistry, 'SpaceRegistryHomeSpaceSet')
        .withArgs(bob.address, EMPTY_BYTES16, spaceId);

      expect(await spaceRegistry.homeSpaceByAddress(bob.address)).to.equal(
        spaceId
      );

      await ethers.provider.send('hardhat_stopImpersonatingAccount', [
        newDaoAddress,
      ]);
    });

    it('should handle multiple home space changes', async () => {
      // Create first space
      await spaceRegistry
        .connect(alice)
        .createSpace(daoSettings, pluginSettings, true);
      const firstSpaceId = await spaceRegistry.generateSpaceId(
        await mockDAOFactory.createdDAOs(0)
      );

      // Create second space
      await spaceRegistry
        .connect(alice)
        .createSpace(daoSettings, pluginSettings, false);
      const secondDaoAddress = await mockDAOFactory.createdDAOs(1);
      const secondSpaceId = await spaceRegistry.generateSpaceId(
        secondDaoAddress
      );

      // Request to change home space
      await spaceRegistry.connect(alice).setHomeSpace(secondSpaceId);

      // Accept the change
      await ethers.provider.send('hardhat_impersonateAccount', [
        secondDaoAddress,
      ]);
      const daoSigner = await ethers.getSigner(secondDaoAddress);
      await owner.sendTransaction({
        to: daoSigner.address,
        value: ethers.utils.parseEther('1'),
      });

      await expect(
        spaceRegistry.connect(daoSigner).acceptHomeSpace(alice.address)
      )
        .to.emit(spaceRegistry, 'SpaceRegistryHomeSpaceSet')
        .withArgs(alice.address, firstSpaceId, secondSpaceId);

      expect(await spaceRegistry.homeSpaceByAddress(alice.address)).to.equal(
        secondSpaceId
      );

      await ethers.provider.send('hardhat_stopImpersonatingAccount', [
        secondDaoAddress,
      ]);
    });

    it('should cancel pending request when requesting a different space', async () => {
      // Create two spaces
      await spaceRegistry
        .connect(alice)
        .createSpace(daoSettings, pluginSettings, false);
      const firstDaoAddress = await mockDAOFactory.createdDAOs(0);
      const firstSpaceId = await spaceRegistry.generateSpaceId(firstDaoAddress);

      await spaceRegistry
        .connect(alice)
        .createSpace(daoSettings, pluginSettings, false);
      const secondDaoAddress = await mockDAOFactory.createdDAOs(1);
      const secondSpaceId = await spaceRegistry.generateSpaceId(
        secondDaoAddress
      );

      // Request first space as home
      await spaceRegistry.connect(bob).setHomeSpace(firstSpaceId);

      // Request second space (should overwrite first pending request)
      await spaceRegistry.connect(bob).setHomeSpace(secondSpaceId);

      // Verify only second space is pending
      expect(await spaceRegistry.pendingHomeSpaceId(bob.address)).to.equal(
        secondSpaceId
      );

      // First DAO should not be able to accept anymore
      await ethers.provider.send('hardhat_impersonateAccount', [
        firstDaoAddress,
      ]);
      const firstDaoSigner = await ethers.getSigner(firstDaoAddress);
      await owner.sendTransaction({
        to: firstDaoSigner.address,
        value: ethers.utils.parseEther('1'),
      });

      await expect(
        spaceRegistry.connect(firstDaoSigner).acceptHomeSpace(bob.address)
      ).to.be.revertedWithCustomError(
        spaceRegistry,
        'SpaceRegistryInvalidCaller'
      );

      await ethers.provider.send('hardhat_stopImpersonatingAccount', [
        firstDaoAddress,
      ]);
    });
  });

  describe('View Functions', () => {
    it('should correctly generate space IDs', async () => {
      const testAddress = '0x1234567890123456789012345678901234567890';
      const spaceId = await spaceRegistry.generateSpaceId(testAddress);

      // Should be deterministic
      const spaceId2 = await spaceRegistry.generateSpaceId(testAddress);
      expect(spaceId).to.equal(spaceId2);

      // Should be 16 bytes
      expect(spaceId.length).to.equal(34); // '0x' + 32 hex chars

      // Different addresses should generate different IDs
      const differentAddress = '0x0987654321098765432109876543210987654321';
      const differentSpaceId = await spaceRegistry.generateSpaceId(
        differentAddress
      );
      expect(spaceId).to.not.equal(differentSpaceId);
    });
  });

  describe('Space Migration', () => {
    let oldDaoAddress: string;
    let spaceId: string;

    beforeEach(async () => {
      // Create a space first
      await spaceRegistry
        .connect(alice)
        .createSpace(daoSettings, pluginSettings, false);

      oldDaoAddress = await mockDAOFactory.createdDAOs(0);
      spaceId = await spaceRegistry.generateSpaceId(oldDaoAddress);
    });

    it('should allow a DAO to migrate its space ID to a new DAO', async () => {
      // Impersonate the DAO
      await ethers.provider.send('hardhat_impersonateAccount', [oldDaoAddress]);
      const daoSigner = await ethers.getSigner(oldDaoAddress);
      await owner.sendTransaction({
        to: daoSigner.address,
        value: ethers.utils.parseEther('1'),
      });

      const tx = await spaceRegistry
        .connect(daoSigner)
        .migrateSpace(daoSettings, pluginSettings);

      const newDaoAddress = await mockDAOFactory.createdDAOs(1); // Second DAO created

      // Check that the space ID is now associated with the new DAO
      expect(await spaceRegistry.daoAddressBySpaceId(spaceId)).to.equal(
        newDaoAddress
      );
      expect(await spaceRegistry.spacesByDAOAddress(newDaoAddress)).to.equal(
        spaceId
      );

      // Check that the old DAO is no longer associated with any space
      expect(await spaceRegistry.spacesByDAOAddress(oldDaoAddress)).to.equal(
        EMPTY_BYTES16
      );

      await expect(tx)
        .to.emit(spaceRegistry, 'SpaceRegistrySpaceMigrated')
        .withArgs(spaceId, oldDaoAddress, newDaoAddress);

      await ethers.provider.send('hardhat_stopImpersonatingAccount', [
        oldDaoAddress,
      ]);
    });

    it('should preserve home space associations during migration', async () => {
      // Set this space as home space for alice
      await spaceRegistry.connect(alice).setHomeSpace(spaceId);

      // Impersonate the DAO to accept
      await ethers.provider.send('hardhat_impersonateAccount', [oldDaoAddress]);
      const daoSigner = await ethers.getSigner(oldDaoAddress);
      await owner.sendTransaction({
        to: daoSigner.address,
        value: ethers.utils.parseEther('1'),
      });

      await spaceRegistry.connect(daoSigner).acceptHomeSpace(alice.address);

      // Now migrate the space
      await spaceRegistry
        .connect(daoSigner)
        .migrateSpace(daoSettings, pluginSettings);

      // Home space association should still point to the same space ID
      expect(await spaceRegistry.homeSpaceByAddress(alice.address)).to.equal(
        spaceId
      );

      await ethers.provider.send('hardhat_stopImpersonatingAccount', [
        oldDaoAddress,
      ]);
    });

    it('should revert if a non-DAO address tries to migrate', async () => {
      await expect(
        spaceRegistry.connect(alice).migrateSpace(daoSettings, pluginSettings)
      )
        .to.be.revertedWithCustomError(
          spaceRegistry,
          'SpaceRegistryInvalidCaller'
        )
        .withArgs(alice.address);
    });
  });
});
