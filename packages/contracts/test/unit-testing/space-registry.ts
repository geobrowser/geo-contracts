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

    it('should create a main personal space', async () => {
      const tx = await spaceRegistry
        .connect(alice)
        .createSpace(daoSettings, pluginSettings, true);

      const createdDaoAddr = await mockDAOFactory.createdDAOs(0);
      const spaceId = await spaceRegistry.generateSpaceId(createdDaoAddr);

      expect(
        await spaceRegistry.mainPersonalSpaceByAddress(alice.address)
      ).to.equal(spaceId);

      await expect(tx)
        .to.emit(spaceRegistry, 'SpaceRegistryMainPersonalSpaceSet')
        .withArgs(alice.address, EMPTY_BYTES16, spaceId);
    });
  });

  describe('Main Personal Space Management', () => {
    let aliceSpaceId: string;
    let aliceDaoAddress: string;

    beforeEach(async () => {
      await spaceRegistry
        .connect(alice)
        .createSpace(daoSettings, pluginSettings, true);

      aliceDaoAddress = await mockDAOFactory.createdDAOs(0);
      aliceSpaceId = await spaceRegistry.generateSpaceId(aliceDaoAddress);
    });

    it('should allow a user to request to set a main personal space', async () => {
      await expect(spaceRegistry.connect(bob).setMainPersonalSpace(aliceSpaceId))
        .to.emit(spaceRegistry, 'SpaceRegistryMainPersonalSpaceUpdatePending')
        .withArgs(bob.address, aliceSpaceId, aliceDaoAddress);

      expect(
        await spaceRegistry.pendingMainPersonalSpaceDAOByAddress(bob.address)
      ).to.equal(aliceDaoAddress);
    });

    it('should revert when setting a main personal space with an invalid spaceId', async () => {
      // This does not correlate to a space that was created so
      // it should revert
      const invalidSpaceId = ethers.utils.formatBytes32String('invalid').slice(0, 34);
      await expect(
        spaceRegistry.connect(bob).setMainPersonalSpace(invalidSpaceId)
      )
        .to.be.revertedWithCustomError(
          spaceRegistry,
          'SpaceRegistryInvalidSpaceId'
        )
        .withArgs(invalidSpaceId);
    });

    it('should allow the DAO to accept the main personal space request', async () => {
      await spaceRegistry.connect(bob).setMainPersonalSpace(aliceSpaceId);

      // We need to impersonate the DAO to call `acceptMainPersonalSpace`
      await ethers.provider.send('hardhat_impersonateAccount', [
        aliceDaoAddress,
      ]);
      const daoSigner = await ethers.getSigner(aliceDaoAddress);
      await owner.sendTransaction({
        to: daoSigner.address,
        value: ethers.utils.parseEther('1'),
      }); // Give it some gas money

      const previousMainPersonalSpace =
        await spaceRegistry.mainPersonalSpaceByAddress(bob.address);

      await expect(
        spaceRegistry.connect(daoSigner).acceptMainPersonalSpace(bob.address)
      )
        .to.emit(spaceRegistry, 'SpaceRegistryMainPersonalSpaceSet')
        .withArgs(bob.address, previousMainPersonalSpace, aliceSpaceId);

      expect(await spaceRegistry.mainPersonalSpaceByAddress(bob.address)).to.equal(
        aliceSpaceId
      );
      expect(
        await spaceRegistry.pendingMainPersonalSpaceDAOByAddress(bob.address)
      ).to.equal(ZERO_ADDRESS);

      await ethers.provider.send('hardhat_stopImpersonatingAccount', [
        aliceDaoAddress,
      ]);
    });

    it('should revert if a non-DAO address tries to accept the main personal space request', async () => {
      await spaceRegistry.connect(bob).setMainPersonalSpace(aliceSpaceId);

      await expect(
        spaceRegistry.connect(alice).acceptMainPersonalSpace(bob.address)
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
});
