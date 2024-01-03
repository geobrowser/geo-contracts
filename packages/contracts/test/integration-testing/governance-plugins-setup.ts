import {GovernancePluginsSetupParams} from '../../plugin-setup-params';
import {
  GovernancePluginsSetup,
  GovernancePluginsSetup__factory,
  MainVotingPlugin,
  MainVotingPlugin__factory,
  MajorityVotingBase,
  MemberAccessPlugin,
  MemberAccessPlugin__factory,
  PluginRepo,
} from '../../typechain';
import {PluginSetupRefStruct} from '../../typechain/@aragon/osx/framework/dao/DAOFactory';
import {UpdatePreparedEvent} from '../../typechain/@aragon/osx/framework/plugin/setup/PluginSetupProcessor';
import {
  findEvent,
  findEventTopicLog,
  getPluginRepoFactoryAddress,
  hashHelpers,
  osxContracts,
} from '../../utils/helpers';
import {toHex} from '../../utils/ipfs';
import {getPluginRepoInfo} from '../../utils/plugin-repo-info';
import {installPlugin, uninstallPlugin} from '../helpers/setup';
import {deployTestDao} from '../helpers/test-dao';
import {
  ADDRESS_ZERO,
  UPGRADE_PLUGIN_PERMISSION_ID,
} from '../unit-testing/common';
// import { getNamedTypesFromMetadata } from "../helpers/types";
import {
  DAO,
  PluginRepo__factory,
  PluginSetupProcessor,
  PluginSetupProcessor__factory,
  PluginRepoFactory__factory,
  PluginRepoRegistry__factory,
  DAO__factory,
} from '@aragon/osx-ethers';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {expect} from 'chai';
import {ethers, network} from 'hardhat';

const release = 1;
const hardhatForkNetwork = process.env.NETWORK_NAME ?? 'mainnet';
const pluginRepoInfo = getPluginRepoInfo(
  GovernancePluginsSetupParams.PLUGIN_REPO_ENS_NAME,
  'hardhat'
);
const pluginSettings: MajorityVotingBase.VotingSettingsStruct = {
  minDuration: 60 * 60 * 24,
  minParticipation: 1,
  supportThreshold: 1,
  minProposerVotingPower: 0,
  votingMode: 0,
};
const minMemberAccessProposalDuration = 60 * 60 * 24;

describe('GovernancePluginsSetup processing', function () {
  let deployer: SignerWithAddress;

  let psp: PluginSetupProcessor;
  let dao: DAO;
  let pluginRepo: PluginRepo;

  before(async () => {
    [deployer] = await ethers.getSigners();

    if (!pluginRepoInfo) {
      throw new Error('The plugin setup details are not available');
    }

    // PSP
    psp = PluginSetupProcessor__factory.connect(
      osxContracts[hardhatForkNetwork]['PluginSetupProcessor'],
      deployer
    );

    // Deploy DAO.
    dao = await deployTestDao(deployer);

    await dao.grant(
      dao.address,
      psp.address,
      ethers.utils.id('ROOT_PERMISSION')
    );
    await dao.grant(
      psp.address,
      deployer.address,
      ethers.utils.id('APPLY_INSTALLATION_PERMISSION')
    );
    await dao.grant(
      psp.address,
      deployer.address,
      ethers.utils.id('APPLY_UNINSTALLATION_PERMISSION')
    );
    await dao.grant(
      psp.address,
      deployer.address,
      ethers.utils.id('APPLY_UPDATE_PERMISSION')
    );

    pluginRepo = PluginRepo__factory.connect(pluginRepoInfo.address, deployer);
  });

  context('Build 1', async () => {
    let setup: GovernancePluginsSetup;
    let pluginSetupRef: PluginSetupRefStruct;
    let mainVotingPlugin: MainVotingPlugin;
    let memberAccessPlugin: MemberAccessPlugin;
    const pluginUpgrader = ADDRESS_ZERO;

    before(async () => {
      // Deploy setups.
      setup = GovernancePluginsSetup__factory.connect(
        (await pluginRepo['getLatestVersion(uint8)'](release)).pluginSetup,
        deployer
      );

      pluginSetupRef = {
        versionTag: {
          release,
          build: 1,
        },
        pluginSetupRepo: pluginRepo.address,
      };
    });

    beforeEach(async () => {
      // Install build 1.
      const data = await setup.encodeInstallationParams(
        pluginSettings,
        [deployer.address],
        minMemberAccessProposalDuration,
        pluginUpgrader
      );
      const installation = await installPlugin(psp, dao, pluginSetupRef, data);

      mainVotingPlugin = MainVotingPlugin__factory.connect(
        installation.preparedEvent.args.plugin,
        deployer
      );
      memberAccessPlugin = MemberAccessPlugin__factory.connect(
        installation.preparedEvent.args.preparedSetupData.helpers[0],
        deployer
      );
    });

    it('installs & uninstalls', async () => {
      expect(await mainVotingPlugin.implementation()).to.be.eq(
        await setup.implementation()
      );
      expect(await memberAccessPlugin.implementation()).to.be.eq(
        await setup.memberAccessPluginImplementation()
      );
      expect(await mainVotingPlugin.dao()).to.be.eq(dao.address);
      expect(await memberAccessPlugin.dao()).to.be.eq(dao.address);

      // Uninstall build 1.
      const data = await setup.encodeUninstallationParams(pluginUpgrader);
      await uninstallPlugin(psp, dao, mainVotingPlugin, pluginSetupRef, data, [
        memberAccessPlugin.address,
      ]);
    });
  });
});

describe('GovernancePluginsSetup with pluginUpgrader', () => {
  let deployer: SignerWithAddress;
  let pluginUpgrader: SignerWithAddress;
  let pSetupBuild1: GovernancePluginsSetup;

  let psp: PluginSetupProcessor;
  let dao: DAO;
  let pluginRepo: PluginRepo;
  let gpsFactory: GovernancePluginsSetup__factory;

  before(async () => {
    [deployer, pluginUpgrader] = await ethers.getSigners();

    // PSP
    psp = PluginSetupProcessor__factory.connect(
      osxContracts[hardhatForkNetwork]['PluginSetupProcessor'],
      deployer
    );

    // Deploy DAO.
    dao = await deployTestDao(deployer);

    await dao.grant(
      dao.address,
      psp.address,
      ethers.utils.id('ROOT_PERMISSION')
    );
    await dao.grant(
      psp.address,
      deployer.address,
      ethers.utils.id('APPLY_INSTALLATION_PERMISSION')
    );

    // Get the PluginRepoFactory address
    const pluginRepoFactoryAddr: string = getPluginRepoFactoryAddress(
      network.name
    );

    const pluginRepoFactory = PluginRepoFactory__factory.connect(
      pluginRepoFactoryAddr,
      deployer
    );

    // Create a new PluginRepo
    let tx = await pluginRepoFactory.createPluginRepo(
      'testing-governance-plugin',
      deployer.address
    );
    const eventLog = await findEventTopicLog(
      tx,
      PluginRepoRegistry__factory.createInterface(),
      'PluginRepoRegistered'
    );
    if (!eventLog) {
      throw new Error('Failed to get PluginRepoRegistered event log');
    }

    pluginRepo = PluginRepo__factory.connect(
      eventLog.args.pluginRepo,
      deployer
    );

    // Deploy PluginSetup build 1
    gpsFactory = new GovernancePluginsSetup__factory().connect(deployer);
    pSetupBuild1 = await gpsFactory.deploy(psp.address);

    // Publish build 1
    tx = await pluginRepo.createVersion(
      1,
      pSetupBuild1.address,
      toHex('build'),
      toHex('release')
    );
  });

  it('Allows pluginUpgrader to call applyUpdate', async () => {
    const pluginSetupRef1: PluginSetupRefStruct = {
      versionTag: {
        release,
        build: 1,
      },
      pluginSetupRepo: pluginRepo.address,
    };
    const pluginSetupRef2: PluginSetupRefStruct = {
      versionTag: {
        release,
        build: 2,
      },
      pluginSetupRepo: pluginRepo.address,
    };

    // Install build 1
    const data1 = await pSetupBuild1.encodeInstallationParams(
      pluginSettings,
      [deployer.address],
      minMemberAccessProposalDuration,
      pluginUpgrader.address
    );
    const installation1 = await installPlugin(psp, dao, pluginSetupRef1, data1);

    // Deployed plugin and helper
    const mainVotingPlugin = MainVotingPlugin__factory.connect(
      installation1.preparedEvent.args.plugin,
      deployer
    );
    const memberAccessPlugin = MemberAccessPlugin__factory.connect(
      installation1.preparedEvent.args.preparedSetupData.helpers[0],
      deployer
    );

    // Check implementations build 1
    expect(await mainVotingPlugin.implementation()).to.be.eq(
      await pSetupBuild1.implementation()
    );
    expect(await memberAccessPlugin.implementation()).to.be.eq(
      await pSetupBuild1.memberAccessPluginImplementation()
    );

    // Deploy PluginSetup build 2 (new instance, disregarding the lack of changes)
    const pSetupBuild2 = await gpsFactory.deploy(psp.address);

    // Publish build 2
    let tx = await pluginRepo.createVersion(
      1,
      pSetupBuild2.address,
      toHex('build'),
      toHex('release')
    );

    // Upgrade to build 2
    tx = await psp.prepareUpdate(dao.address, {
      currentVersionTag: {
        release: release,
        build: 1,
      },
      newVersionTag: {
        release: release,
        build: 2,
      },
      pluginSetupRepo: pluginRepo.address,
      setupPayload: {
        currentHelpers: [memberAccessPlugin.address],
        data: toHex(''),
        plugin: mainVotingPlugin.address,
      },
    });
    const preparedEvent = await findEvent<UpdatePreparedEvent>(
      tx,
      'UpdatePrepared'
    );
    if (!preparedEvent) {
      throw new Error('Failed to get UpdatePrepared event');
    }

    // Params
    const applyUpdateParams: PluginSetupProcessor.ApplyUpdateParamsStruct = {
      plugin: mainVotingPlugin.address,
      pluginSetupRef: {
        pluginSetupRepo: pluginRepo.address,
        versionTag: {
          release,
          build: 2,
        },
      },
      initData: preparedEvent.args.initData,
      permissions: preparedEvent.args.preparedSetupData.permissions,
      helpersHash: hashHelpers(preparedEvent.args.preparedSetupData.helpers),
    };

    // Execute grant + applyUpdate + revoke
    dao.connect(pluginUpgrader).execute(
      toHex(Date.now().toString()),
      [
        // Grant permission to the PSP
        {
          to: dao.address,
          value: 0,
          data: DAO__factory.createInterface().encodeFunctionData('grant', [
            mainVotingPlugin.address,
            psp.address,
            UPGRADE_PLUGIN_PERMISSION_ID,
          ]),
        },
        // Execute psp.applyUpdate() from the DAO to the plugin
        {
          to: psp.address,
          value: 0,
          data: PluginSetupProcessor__factory.createInterface().encodeFunctionData(
            'applyUpdate',
            [dao.address, applyUpdateParams]
          ),
        },
        // Revoke permission to the PSP
        {
          to: dao.address,
          value: 0,
          data: DAO__factory.createInterface().encodeFunctionData('revoke', [
            mainVotingPlugin.address,
            psp.address,
            UPGRADE_PLUGIN_PERMISSION_ID,
          ]),
        },
      ],
      0
    );

    // Check implementations build 2
    expect(await mainVotingPlugin.implementation()).to.not.be.eq(
      await pSetupBuild1.implementation(),
      "Implementation shouldn't be build 1"
    );
    expect(await memberAccessPlugin.implementation()).to.not.be.eq(
      await pSetupBuild1.memberAccessPluginImplementation(),
      "Implementation shouldn't be build 1"
    );

    expect(await mainVotingPlugin.implementation()).to.be.eq(
      await pSetupBuild2.implementation(),
      'Implementation should be build 2'
    );
    expect(await memberAccessPlugin.implementation()).to.be.eq(
      await pSetupBuild2.memberAccessPluginImplementation(),
      'Implementation should be build 2'
    );
  });
});
