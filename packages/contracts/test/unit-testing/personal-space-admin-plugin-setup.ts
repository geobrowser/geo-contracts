import {
  PersonalSpaceAdminPlugin__factory,
  PersonalSpaceAdminPluginSetup,
  PersonalSpaceAdminPluginSetup__factory,
} from '../../typechain';
import {getInterfaceID} from '../../utils/interfaces';
import {deployTestDao} from '../helpers/test-dao';
import {Operation} from '../helpers/types';
import {psvpInterface} from './personal-space-admin-plugin';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {expect} from 'chai';
import {ethers} from 'hardhat';

const AddressZero = ethers.constants.AddressZero;
const EMPTY_DATA = '0x';

// Permissions
const EDITOR_PERMISSION_ID = ethers.utils.id('EDITOR_PERMISSION');
const MEMBER_PERMISSION_ID = ethers.utils.id('MEMBER_PERMISSION');
const EXECUTE_PERMISSION_ID = ethers.utils.id('EXECUTE_PERMISSION');

describe('Personal Space Admin Plugin Setup', function () {
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;
  let dave: SignerWithAddress;
  let adminSetup: PersonalSpaceAdminPluginSetup;
  let implementationAddress: string;
  let targetDao: any;
  let prepareInstallationData: string;

  before(async () => {
    [alice, bob, carol, dave] = await ethers.getSigners();
    targetDao = await deployTestDao(alice);

    const PersonalSpaceAdminPluginSetup =
      new PersonalSpaceAdminPluginSetup__factory(alice);
    adminSetup = await PersonalSpaceAdminPluginSetup.deploy();

    implementationAddress = await adminSetup.implementation();

    const initialEditors = [alice.address, bob.address];
    const initialMembers = [carol.address, dave.address];

    prepareInstallationData = await adminSetup.encodeInstallationParams(
      initialEditors,
      initialMembers
    );
  });

  it('does not support the empty interface', async () => {
    expect(await adminSetup.supportsInterface('0xffffffff')).to.be.false;
  });

  it('creates admin address base with the correct interface', async () => {
    const factory = new PersonalSpaceAdminPlugin__factory(alice);
    const adminAddressContract = factory.attach(implementationAddress);

    expect(
      await adminAddressContract.supportsInterface(
        getInterfaceID(psvpInterface)
      )
    ).to.be.eq(true);
  });

  describe('prepareInstallation', async () => {
    it('fails if data is empty, or not of minimum length', async () => {
      await expect(
        adminSetup.prepareInstallation(targetDao.address, EMPTY_DATA)
      ).to.be.reverted;

      await expect(
        adminSetup.prepareInstallation(
          targetDao.address,
          prepareInstallationData.substring(
            0,
            prepareInstallationData.length - 2
          )
        )
      ).to.be.reverted;

      await expect(
        adminSetup.prepareInstallation(
          targetDao.address,
          prepareInstallationData
        )
      ).not.to.be.reverted;
    });

    it('correctly returns plugin, helpers and permissions', async () => {
      const nonce = await ethers.provider.getTransactionCount(
        adminSetup.address
      );
      const anticipatedPluginAddress = ethers.utils.getContractAddress({
        from: adminSetup.address,
        nonce,
      });

      const {
        plugin,
        preparedSetupData: {helpers, permissions},
      } = await adminSetup.callStatic.prepareInstallation(
        targetDao.address,
        prepareInstallationData
      );

      expect(plugin).to.be.equal(anticipatedPluginAddress);
      expect(helpers.length).to.be.equal(0);
      expect(permissions.length).to.be.equal(5);
      expect(permissions).to.deep.equal([
        [
          Operation.Grant,
          plugin,
          alice.address,
          AddressZero,
          EDITOR_PERMISSION_ID,
        ],
        [
          Operation.Grant,
          plugin,
          bob.address,
          AddressZero,
          EDITOR_PERMISSION_ID,
        ],
        [
          Operation.Grant,
          plugin,
          carol.address,
          AddressZero,
          MEMBER_PERMISSION_ID,
        ],
        [
          Operation.Grant,
          plugin,
          dave.address,
          AddressZero,
          MEMBER_PERMISSION_ID,
        ],
        [
          Operation.Grant,
          targetDao.address,
          plugin,
          AddressZero,
          EXECUTE_PERMISSION_ID,
        ],
      ]);
    });

    it('correctly sets up the plugin', async () => {
      const daoAddress = targetDao.address;

      const nonce = await ethers.provider.getTransactionCount(
        adminSetup.address
      );
      const anticipatedPluginAddress = ethers.utils.getContractAddress({
        from: adminSetup.address,
        nonce,
      });

      await adminSetup.prepareInstallation(daoAddress, prepareInstallationData);

      const factory = new PersonalSpaceAdminPlugin__factory(alice);
      const adminAddressContract = factory.attach(anticipatedPluginAddress);

      expect(await adminAddressContract.dao()).to.be.equal(daoAddress);
    });
  });

  describe('prepareUninstallation', async () => {
    it('correctly returns permissions', async () => {
      const plugin = ethers.Wallet.createRandom().address;

      const permissions = await adminSetup.callStatic.prepareUninstallation(
        targetDao.address,
        {
          plugin,
          currentHelpers: [],
          data: EMPTY_DATA,
        }
      );

      expect(permissions.length).to.be.equal(1);
      expect(permissions).to.deep.equal([
        [
          Operation.Revoke,
          targetDao.address,
          plugin,
          AddressZero,
          EXECUTE_PERMISSION_ID,
        ],
      ]);
    });
  });
});
