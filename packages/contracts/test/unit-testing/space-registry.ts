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
    console.log('beforeEach');
    console.log(process.env.NETWORK_NAME);
    console.log('getting signers');
    [owner, alice, bob] = await ethers.getSigners();
    console.log('deploying mockDAOFactory');
    mockDAOFactory = await new MockDAOFactory__factory(owner).deploy();
    console.log('deploying spaceRegistry');
    spaceRegistry = await deployWithProxy<SpaceRegistry>(
      new SpaceRegistry__factory(owner)
    );
    console.log('initializing spaceRegistry');
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

      expect(
        await spaceRegistry.homeSpaceByAddress(alice.address)
      ).to.equal(spaceId);

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

      expect(
        await spaceRegistry.pendingHomeSpaceDAOByAddress(bob.address)
      ).to.equal(aliceDaoAddress);
    });

    it('should revert when setting a home space with an invalid spaceId', async () => {
      // This does not correlate to a space that was created so
      // it should revert
      const invalidSpaceId = ethers.utils.formatBytes32String('invalid').slice(0, 34);
      await expect(
        spaceRegistry.connect(bob).setHomeSpace(invalidSpaceId)
      )
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

      const previousHomeSpace =
        await spaceRegistry.homeSpaceByAddress(bob.address);

      await expect(
        spaceRegistry.connect(daoSigner).acceptHomeSpace(bob.address)
      )
        .to.emit(spaceRegistry, 'SpaceRegistryHomeSpaceSet')
        .withArgs(bob.address, previousHomeSpace, aliceSpaceId);

      expect(await spaceRegistry.homeSpaceByAddress(bob.address)).to.equal(
        aliceSpaceId
      );
      expect(
        await spaceRegistry.pendingHomeSpaceDAOByAddress(bob.address)
      ).to.equal(ZERO_ADDRESS);

      await ethers.provider.send('hardhat_stopImpersonatingAccount', [
        aliceDaoAddress,
      ]);
    });

    it('should revert if a non-DAO address tries to accept the home space request', async () => {
      await spaceRegistry.connect(bob).setHomeSpace(aliceSpaceId);

      await expect(
        spaceRegistry.connect(alice).acceptHomeSpace(bob.address)
      )
        .to.be.revertedWithCustomError(
          spaceRegistry,
          'SpaceRegistryInvalidCaller'
        )
        .withArgs(alice.address);
    });
  });

  describe('Owner-only functions', () => {
    it('should allow the owner to create a space with a specific ID', async () => {
      const spaceId = ethers.utils.formatBytes32String('my-custom-space').slice(0, 34);
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
      const spaceId = ethers.utils.formatBytes32String('my-custom-space').slice(0, 34);
      await expect(
        spaceRegistry
          .connect(alice)
          .createSpaceWithId(daoSettings, pluginSettings, spaceId)
      ).to.be.revertedWith('Ownable: caller is not the owner');
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
