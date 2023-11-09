import {
  DAO,
  IDAO,
  IERC165Upgradeable__factory,
  IMultisig__factory,
  IPlugin__factory,
  IProposal__factory,
  MainVotingPlugin,
  MainVotingPlugin__factory,
  MemberAccessPlugin,
  MemberAccessPlugin__factory,
  SpacePlugin,
  SpacePlugin__factory,
} from '../../typechain';
import {
  ApprovedEvent,
  ProposalCreatedEvent,
} from '../../typechain/src/MemberAccessPlugin';
import {deployWithProxy, findEvent} from '../../utils/helpers';
import {getInterfaceID} from '../../utils/interfaces';
import {deployTestDao} from '../helpers/test-dao';
import {
  ADDRESS_ONE,
  ADDRESS_TWO,
  ADDRESS_ZERO,
  EMPTY_DATA,
  EXECUTE_PERMISSION_ID,
  MEMBER_PERMISSION_ID,
  mineBlock,
  ROOT_PERMISSION_ID,
  UPDATE_ADDRESSES_PERMISSION_ID,
  UPDATE_MULTISIG_SETTINGS_PERMISSION_ID,
  UPGRADE_PLUGIN_PERMISSION_ID,
  VoteOption,
  ZERO_BYTES32,
} from './common';
import {defaultMainVotingSettings} from './common';
import {DAO__factory} from '@aragon/osx-ethers';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {expect} from 'chai';
import {hexlify, toUtf8Bytes} from 'ethers/lib/utils';
import {ethers} from 'hardhat';

export type InitData = {contentUri: string};
export const defaultInitData: InitData = {
  contentUri: 'ipfs://',
};

export const multisigInterface = new ethers.utils.Interface([
  'function initialize(address,tuple(uint64,address))',
  'function updateMultisigSettings(tuple(uint64,address))',
  'function proposeNewMember(bytes,address)',
  'function proposeRemoveMember(bytes,address)',
  'function getProposal(uint256)',
]);

describe('Member Access Plugin', function () {
  let signers: SignerWithAddress[];
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;
  let dave: SignerWithAddress;
  let dao: DAO;
  let memberAccessPlugin: MemberAccessPlugin;
  let mainVotingPlugin: MainVotingPlugin;
  let spacePlugin: SpacePlugin;
  let defaultInput: InitData;

  before(async () => {
    signers = await ethers.getSigners();
    [alice, bob, carol, dave] = signers;
    dao = await deployTestDao(alice);

    defaultInput = {contentUri: 'ipfs://'};
  });

  beforeEach(async () => {
    memberAccessPlugin = await deployWithProxy<MemberAccessPlugin>(
      new MemberAccessPlugin__factory(alice)
    );
    mainVotingPlugin = await deployWithProxy<MainVotingPlugin>(
      new MainVotingPlugin__factory(alice)
    );
    spacePlugin = await deployWithProxy<SpacePlugin>(
      new SpacePlugin__factory(alice)
    );

    // inits
    await memberAccessPlugin.initialize(dao.address, {
      proposalDuration: 60 * 60 * 24 * 5,
      mainVotingPlugin: mainVotingPlugin.address,
    });
    await mainVotingPlugin.initialize(dao.address, defaultMainVotingSettings, [
      alice.address,
    ]);
    await spacePlugin.initialize(
      dao.address,
      defaultInput.contentUri,
      ADDRESS_ZERO
    );

    // Alice is an editor (see mainVotingPlugin initialize)

    // Bob is a member
    await dao.grant(
      mainVotingPlugin.address,
      bob.address,
      MEMBER_PERMISSION_ID
    );
    // The plugin can execute on the DAO
    await dao.grant(
      dao.address,
      memberAccessPlugin.address,
      EXECUTE_PERMISSION_ID
    );
    // The main voting plugin can also execute on the DAO
    await dao.grant(
      dao.address,
      mainVotingPlugin.address,
      EXECUTE_PERMISSION_ID
    );
    // The DAO can report new/removed editors to the main voting plugin
    await dao.grant(
      mainVotingPlugin.address,
      dao.address,
      UPDATE_ADDRESSES_PERMISSION_ID
    );
    // The DAO can update the plugin settings
    await dao.grant(
      memberAccessPlugin.address,
      dao.address,
      UPDATE_MULTISIG_SETTINGS_PERMISSION_ID
    );
    // The DAO can upgrade the plugin
    await dao.grant(
      memberAccessPlugin.address,
      dao.address,
      UPGRADE_PLUGIN_PERMISSION_ID
    );
    // The DAO is ROOT on itself
    await dao.grant(dao.address, dao.address, ROOT_PERMISSION_ID);
    // Alice can make the DAO execute arbitrary stuff (test)
    await dao.grant(dao.address, alice.address, EXECUTE_PERMISSION_ID);
  });

  describe('initialize', () => {
    it('Fails to initialize with an incompatible main voting plugin', async () => {
      // ok
      memberAccessPlugin = await deployWithProxy<MemberAccessPlugin>(
        new MemberAccessPlugin__factory(alice)
      );
      await expect(
        memberAccessPlugin.initialize(dao.address, {
          proposalDuration: 60 * 60 * 24 * 5,
          mainVotingPlugin: mainVotingPlugin.address,
        })
      ).to.not.be.reverted;

      // not ok
      memberAccessPlugin = await deployWithProxy<MemberAccessPlugin>(
        new MemberAccessPlugin__factory(alice)
      );
      await expect(
        memberAccessPlugin.initialize(dao.address, {
          proposalDuration: 60 * 60 * 24 * 5,
          mainVotingPlugin: ADDRESS_ONE,
        })
      ).to.be.reverted;

      // not ok
      memberAccessPlugin = await deployWithProxy<MemberAccessPlugin>(
        new MemberAccessPlugin__factory(alice)
      );
      await expect(
        memberAccessPlugin.initialize(dao.address, {
          proposalDuration: 60 * 60 * 24 * 5,
          mainVotingPlugin: carol.address,
        })
      ).to.be.reverted;
    });
  });

  describe('Before approving', () => {
    it('Allows any address to request membership', async () => {
      // Random
      await expect(
        memberAccessPlugin
          .connect(carol)
          .proposeNewMember(toUtf8Bytes('ipfs://1234'), carol.address)
      ).to.not.be.reverted;

      let proposal = await memberAccessPlugin.getProposal(0);
      expect(proposal.executed).to.eq(false);
      expect(proposal.approvals).to.eq(0);
      expect(proposal.parameters.minApprovals).to.eq(1);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.failsafeActionMap).to.eq(0);
      expect(await memberAccessPlugin.isMember(carol.address)).to.eq(false);
      expect(await mainVotingPlugin.isMember(carol.address)).to.eq(false);

      // Member
      await expect(
        memberAccessPlugin
          .connect(bob)
          .proposeNewMember(toUtf8Bytes('ipfs://1234'), ADDRESS_ONE)
      ).to.not.be.reverted;

      proposal = await memberAccessPlugin.getProposal(0);
      expect(proposal.executed).to.eq(false);
      expect(proposal.approvals).to.eq(0);
      expect(proposal.parameters.minApprovals).to.eq(1);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.failsafeActionMap).to.eq(0);
      expect(await memberAccessPlugin.isMember(ADDRESS_ONE)).to.eq(false);
      expect(await mainVotingPlugin.isMember(ADDRESS_ONE)).to.eq(false);

      // Editor
      await expect(
        memberAccessPlugin
          .connect(alice)
          .proposeNewMember(toUtf8Bytes('ipfs://1234'), ADDRESS_TWO)
      ).to.not.be.reverted;

      proposal = await memberAccessPlugin.getProposal(1);
      expect(proposal.executed).to.eq(false);
      expect(proposal.approvals).to.eq(0);
      expect(proposal.parameters.minApprovals).to.eq(1);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.failsafeActionMap).to.eq(0);
      // Auto executed
      expect(await memberAccessPlugin.isMember(ADDRESS_TWO)).to.eq(true);
      expect(await mainVotingPlugin.isMember(ADDRESS_TWO)).to.eq(true);
    });

    it('Editors should be members too', async () => {
      expect(await memberAccessPlugin.isMember(alice.address)).to.eq(true);
      expect(await mainVotingPlugin.isMember(alice.address)).to.eq(true);
    });

    it('Emits an event when membership is requested', async () => {
      const tx = await memberAccessPlugin
        .connect(carol)
        .proposeNewMember(toUtf8Bytes('ipfs://2345'), carol.address);

      await expect(tx).to.emit(memberAccessPlugin, 'ProposalCreated');

      const event = await findEvent<ProposalCreatedEvent>(
        tx,
        'ProposalCreated'
      );

      expect(!!event).to.eq(true);
      expect(event!.args.proposalId).to.equal(0);
      expect(event!.args.creator).to.equal(carol.address);
      expect(event!.args.metadata).to.equal(
        hexlify(toUtf8Bytes('ipfs://2345'))
      );
      expect(event!.args.actions.length).to.equal(1);
      expect(event!.args.actions[0].to).to.equal(dao.address);
      expect(event!.args.actions[0].value).to.equal(0);
      expect(event!.args.actions[0].data).to.equal(
        DAO__factory.createInterface().encodeFunctionData('grant', [
          mainVotingPlugin.address,
          carol.address,
          MEMBER_PERMISSION_ID,
        ])
      );
      expect(event!.args.allowFailureMap).to.equal(0);
    });

    it('isMember() returns true when appropriate', async () => {
      expect(await memberAccessPlugin.isMember(ADDRESS_ZERO)).to.eq(false);
      expect(await memberAccessPlugin.isMember(ADDRESS_ONE)).to.eq(false);
      expect(await memberAccessPlugin.isMember(ADDRESS_TWO)).to.eq(false);

      expect(await memberAccessPlugin.isMember(alice.address)).to.eq(true);
      expect(await memberAccessPlugin.isMember(bob.address)).to.eq(true);

      expect(await memberAccessPlugin.isMember(carol.address)).to.eq(false);

      await dao.grant(
        mainVotingPlugin.address,
        carol.address,
        MEMBER_PERMISSION_ID
      );

      expect(await memberAccessPlugin.isMember(carol.address)).to.eq(true);

      await dao.revoke(
        mainVotingPlugin.address,
        carol.address,
        MEMBER_PERMISSION_ID
      );

      expect(await memberAccessPlugin.isMember(carol.address)).to.eq(false);

      await proposeNewEditor(carol.address);

      expect(await memberAccessPlugin.isMember(carol.address)).to.eq(true);
    });

    it('isEditor() returns true when appropriate', async () => {
      expect(await memberAccessPlugin.isEditor(ADDRESS_ZERO)).to.eq(false);
      expect(await memberAccessPlugin.isEditor(ADDRESS_ONE)).to.eq(false);
      expect(await memberAccessPlugin.isEditor(ADDRESS_TWO)).to.eq(false);

      expect(await memberAccessPlugin.isEditor(alice.address)).to.eq(true);
      expect(await memberAccessPlugin.isEditor(bob.address)).to.eq(false);
      expect(await memberAccessPlugin.isEditor(carol.address)).to.eq(false);

      await proposeNewEditor(carol.address);

      expect(await memberAccessPlugin.isEditor(carol.address)).to.eq(true);
    });
  });

  describe('One editor case', () => {
    it('Only the editor can approve memberships', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(1);

      await expect(
        memberAccessPlugin
          .connect(carol)
          .proposeNewMember(toUtf8Bytes('ipfs://1234'), carol.address)
      ).to.not.be.reverted;

      expect(await memberAccessPlugin.isMember(carol.address)).to.eq(false);

      // Approve it (Bob) => fail
      await expect(memberAccessPlugin.connect(bob).approve(0, false)).to.be
        .reverted;

      // Still not a member
      expect(await memberAccessPlugin.isMember(carol.address)).to.eq(false);

      // Approve it (Alice) => success
      await expect(memberAccessPlugin.connect(alice).approve(0, false)).to.not
        .be.reverted;

      // Now Carol is a member
      expect(await memberAccessPlugin.isMember(carol.address)).to.eq(true);
    });

    it('Only the editor can reject memberships', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(1);

      expect(
        await dao.hasPermission(
          mainVotingPlugin.address,
          carol.address,
          MEMBER_PERMISSION_ID,
          toUtf8Bytes('')
        )
      ).to.eq(false);

      await expect(
        memberAccessPlugin
          .connect(carol)
          .proposeNewMember(toUtf8Bytes('ipfs://1234'), carol.address)
      ).to.not.be.reverted;

      expect(
        await dao.hasPermission(
          mainVotingPlugin.address,
          carol.address,
          MEMBER_PERMISSION_ID,
          toUtf8Bytes('')
        )
      ).to.eq(false);

      // Reject it (Bob) => fail
      await expect(memberAccessPlugin.connect(bob).reject(0)).to.be.reverted;

      // Still not a member
      expect(
        await dao.hasPermission(
          mainVotingPlugin.address,
          carol.address,
          MEMBER_PERMISSION_ID,
          toUtf8Bytes('')
        )
      ).to.eq(false);

      // Reject it (Alice) => success
      await expect(memberAccessPlugin.connect(alice).reject(0)).to.not.be
        .reverted;

      // Carol is not a member
      expect(
        await dao.hasPermission(
          mainVotingPlugin.address,
          carol.address,
          MEMBER_PERMISSION_ID,
          toUtf8Bytes('')
        )
      ).to.eq(false);

      // Try to approve it (Alice) => fail
      await expect(memberAccessPlugin.connect(alice).approve(0, false)).to.be
        .reverted;
    });

    it('Membership approvals are immediate', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(1);

      await expect(
        memberAccessPlugin
          .connect(carol)
          .proposeNewMember(toUtf8Bytes('ipfs://1234'), carol.address)
      ).to.not.be.reverted;

      // Approve it (Alice) => success
      await expect(memberAccessPlugin.connect(alice).approve(0, false)).to.not
        .be.reverted;

      const proposal = await memberAccessPlugin.getProposal(0);
      expect(proposal.executed).to.eq(true);

      // Approve it (Alice) => fail
      await expect(memberAccessPlugin.connect(alice).approve(0, false)).to.be
        .reverted;
    });

    it('Membership rejections are immediate', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(1);

      await expect(
        memberAccessPlugin
          .connect(carol)
          .proposeNewMember(toUtf8Bytes('ipfs://1234'), carol.address)
      ).to.not.be.reverted;

      // Reject it (Alice) => success
      await expect(memberAccessPlugin.connect(alice).reject(0)).to.not.be
        .reverted;

      const proposal = await memberAccessPlugin.getProposal(0);
      expect(proposal.executed).to.eq(false);

      // Try to approve it (Alice) => fail
      await expect(memberAccessPlugin.connect(bob).reject(0)).to.be.reverted;
    });

    it('Proposal execution is immediate when created by the only editor', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(1);

      expect(await memberAccessPlugin.isMember(carol.address)).to.eq(false);

      // Alice proposes
      await expect(
        memberAccessPlugin.proposeNewMember(
          toUtf8Bytes('ipfs://1234'),
          carol.address
        )
      ).to.not.be.reverted;

      // Now Carol is a member
      expect(await memberAccessPlugin.isMember(carol.address)).to.eq(true);

      // Undo
      await expect(
        memberAccessPlugin.proposeRemoveMember(
          toUtf8Bytes('ipfs://1234'),
          carol.address
        )
      ).to.not.be.reverted;

      // Carol is no longer a member
      expect(await memberAccessPlugin.isMember(carol.address)).to.eq(false);
    });

    it("Proposals created by a non-editor need an editor's approval", async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(1);
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(false);

      await expect(
        memberAccessPlugin
          .connect(dave)
          .proposeNewMember(toUtf8Bytes('ipfs://1234'), dave.address)
      ).to.not.be.reverted;
      const pid = 0;

      const proposal = await memberAccessPlugin.getProposal(pid);
      expect(proposal.executed).to.eq(false);
      expect(proposal.parameters.minApprovals).to.eq(1);
      expect(await memberAccessPlugin.canExecute(pid)).to.eq(false);
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(false);

      // Dave cannot
      await expect(memberAccessPlugin.connect(dave).approve(pid, false)).to.be
        .reverted;
      await expect(memberAccessPlugin.connect(dave).execute(pid)).to.be
        .reverted;
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(false);

      // Alice can
      await expect(memberAccessPlugin.connect(alice).approve(pid, false)).to.not
        .be.reverted;
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(true);
    });
  });

  describe('Multiple editors case', () => {
    // Alice: editor
    // Bob: editor
    // Carol: editor

    beforeEach(async () => {
      let pidMainVoting = 0;
      await proposeNewEditor(bob.address);
      await proposeNewEditor(carol.address);
      pidMainVoting = 1;
      await mainVotingPlugin
        .connect(bob)
        .vote(pidMainVoting, VoteOption.Yes, true);
    });

    it('Only editors can approve new memberships', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(3);

      // Requesting membership for Dave
      let pid = 0;
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(false);
      await expect(
        memberAccessPlugin
          .connect(dave)
          .proposeNewMember(toUtf8Bytes('ipfs://1234'), dave.address)
      ).to.not.be.reverted;
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(false);

      // Dave cannot approve (fail)
      await expect(memberAccessPlugin.connect(dave).approve(pid, false)).to.be
        .reverted;

      // Dave is still not a member
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(false);

      // Approve it (Alice)
      await expect(memberAccessPlugin.connect(alice).approve(pid, false)).to.not
        .be.reverted;

      // Dave is now a member
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(true);

      // Now requesting for 0x1
      expect(await memberAccessPlugin.isMember(ADDRESS_ONE)).to.eq(false);
      await expect(
        memberAccessPlugin
          .connect(dave)
          .proposeNewMember(toUtf8Bytes('ipfs://1234'), ADDRESS_ONE)
      ).to.not.be.reverted;
      pid++;
      expect(await memberAccessPlugin.isMember(ADDRESS_ONE)).to.eq(false);

      // Dave cannot approve (fail)
      await expect(memberAccessPlugin.connect(dave).approve(pid, false)).to.be
        .reverted;

      // ADDRESS_ONE is still not a member
      expect(await memberAccessPlugin.isMember(ADDRESS_ONE)).to.eq(false);

      // Approve it (Bob)
      await expect(memberAccessPlugin.connect(bob).approve(pid, false)).to.not
        .be.reverted;

      // ADDRESS_ONE is now a member
      expect(await memberAccessPlugin.isMember(ADDRESS_ONE)).to.eq(true);

      // Now requesting for 0x2
      expect(await memberAccessPlugin.isMember(ADDRESS_TWO)).to.eq(false);
      await expect(
        memberAccessPlugin
          .connect(dave)
          .proposeNewMember(toUtf8Bytes('ipfs://1234'), ADDRESS_TWO)
      ).to.not.be.reverted;
      pid++;
      expect(await memberAccessPlugin.isMember(ADDRESS_TWO)).to.eq(false);

      // Dave cannot approve (fail)
      await expect(memberAccessPlugin.connect(dave).approve(pid, false)).to.be
        .reverted;

      // ADDRESS_TWO is still not a member
      expect(await memberAccessPlugin.isMember(ADDRESS_TWO)).to.eq(false);

      // Approve it (Carol)
      await expect(memberAccessPlugin.connect(carol).approve(pid, false)).to.not
        .be.reverted;

      // ADDRESS_TWO is now a member
      expect(await memberAccessPlugin.isMember(ADDRESS_TWO)).to.eq(true);
    });

    it('Only editors can approve removing memberships', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(3);
      await dao.grant(
        mainVotingPlugin.address,
        dave.address,
        MEMBER_PERMISSION_ID
      );
      await dao.grant(
        mainVotingPlugin.address,
        ADDRESS_ONE,
        MEMBER_PERMISSION_ID
      );
      await dao.grant(
        mainVotingPlugin.address,
        ADDRESS_TWO,
        MEMBER_PERMISSION_ID
      );

      // Requesting membership for Dave
      let pid = 0;
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(true);
      await expect(
        memberAccessPlugin
          .connect(dave)
          .proposeRemoveMember(toUtf8Bytes('ipfs://1234'), dave.address)
      ).to.not.be.reverted;
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(true);

      // Dave cannot approve (fail)
      await expect(memberAccessPlugin.connect(dave).approve(pid, false)).to.be
        .reverted;

      // Dave remains as a member
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(true);

      // Approve it (Alice)
      await expect(memberAccessPlugin.connect(alice).approve(pid, false)).to.not
        .be.reverted;

      // Dave is no longer a member
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(false);

      // Now requesting for 0x1
      expect(await memberAccessPlugin.isMember(ADDRESS_ONE)).to.eq(true);
      await expect(
        memberAccessPlugin
          .connect(dave)
          .proposeRemoveMember(toUtf8Bytes('ipfs://1234'), ADDRESS_ONE)
      ).to.not.be.reverted;
      pid++;
      expect(await memberAccessPlugin.isMember(ADDRESS_ONE)).to.eq(true);

      // Dave cannot approve (fail)
      await expect(memberAccessPlugin.connect(dave).approve(pid, false)).to.be
        .reverted;

      // ADDRESS_ONE remains as a member
      expect(await memberAccessPlugin.isMember(ADDRESS_ONE)).to.eq(true);

      // Approve it (Bob)
      await expect(memberAccessPlugin.connect(bob).approve(pid, false)).to.not
        .be.reverted;

      // ADDRESS_ONE is no longer a member
      expect(await memberAccessPlugin.isMember(ADDRESS_ONE)).to.eq(false);

      // Now requesting for 0x2
      expect(await memberAccessPlugin.isMember(ADDRESS_TWO)).to.eq(true);
      await expect(
        memberAccessPlugin
          .connect(dave)
          .proposeRemoveMember(toUtf8Bytes('ipfs://1234'), ADDRESS_TWO)
      ).to.not.be.reverted;
      pid++;
      expect(await memberAccessPlugin.isMember(ADDRESS_TWO)).to.eq(true);

      // Dave cannot approve (fail)
      await expect(memberAccessPlugin.connect(dave).approve(pid, false)).to.be
        .reverted;

      // ADDRESS_TWO remains as a member
      expect(await memberAccessPlugin.isMember(ADDRESS_TWO)).to.eq(true);

      // Approve it (Carol)
      await expect(memberAccessPlugin.connect(carol).approve(pid, false)).to.not
        .be.reverted;

      // ADDRESS_TWO is no longer a member
      expect(await memberAccessPlugin.isMember(ADDRESS_TWO)).to.eq(false);
    });

    it('Proposals should be unsettled after created', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(3);

      // Proposed by a random wallet
      await expect(
        memberAccessPlugin
          .connect(dave)
          .proposeNewMember(toUtf8Bytes('ipfs://1234'), dave.address)
      ).to.not.be.reverted;
      let pid = 0;

      let proposal = await memberAccessPlugin.getProposal(pid);
      expect(proposal.executed).to.eq(false);
      expect(proposal.parameters.minApprovals).to.eq(1);
      expect(await memberAccessPlugin.canExecute(pid)).to.eq(false);
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(false);

      await dao
        .grant(mainVotingPlugin.address, dave.address, MEMBER_PERMISSION_ID)
        .then(tx => tx.wait());

      // Proposed by a (now) member
      await expect(
        memberAccessPlugin
          .connect(dave)
          .proposeNewMember(toUtf8Bytes('ipfs://1234'), ADDRESS_ONE)
      ).to.not.be.reverted;
      pid++;

      expect((await memberAccessPlugin.getProposal(pid)).executed).to.eq(false);
      expect(proposal.parameters.minApprovals).to.eq(1);
      expect(await memberAccessPlugin.canExecute(pid)).to.eq(false);
      expect(await memberAccessPlugin.isMember(ADDRESS_ONE)).to.eq(false);

      // Proposed by an editor
      await expect(
        memberAccessPlugin
          .connect(alice)
          .proposeNewMember(toUtf8Bytes('ipfs://1234'), ADDRESS_TWO)
      ).to.not.be.reverted;
      pid++;

      proposal = await memberAccessPlugin.getProposal(pid);
      expect(proposal.executed).to.eq(false);
      expect(proposal.parameters.minApprovals).to.eq(2);
      expect(await memberAccessPlugin.canExecute(pid)).to.eq(false);
      expect(await memberAccessPlugin.isMember(ADDRESS_TWO)).to.eq(false);
    });

    it('Only editors can reject new membership proposals', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(3);

      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(false);

      await expect(
        memberAccessPlugin
          .connect(dave)
          .proposeNewMember(toUtf8Bytes('ipfs://1234'), dave.address)
      ).to.not.be.reverted;

      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(false);

      // Reject it (Dave) => fail
      await expect(memberAccessPlugin.connect(dave).reject(0)).to.be.reverted;

      // Still not a member
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(false);

      // Reject it (Bob) => success
      await expect(memberAccessPlugin.connect(bob).reject(0)).to.not.be
        .reverted;

      // Still not a member
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(false);

      // Try to approve it (bob) => fail
      await expect(memberAccessPlugin.connect(bob).approve(0, false)).to.be
        .reverted;

      expect((await memberAccessPlugin.getProposal(0)).executed).to.eq(false);
    });

    it('Only editors can reject membership removal proposals', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(3);
      await dao
        .grant(mainVotingPlugin.address, dave.address, MEMBER_PERMISSION_ID)
        .then(tx => tx.wait());

      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(true);

      await expect(
        memberAccessPlugin
          .connect(dave)
          .proposeRemoveMember(toUtf8Bytes('ipfs://1234'), dave.address)
      ).to.not.be.reverted;

      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(true);

      // Reject it (Dave) => fail
      await expect(memberAccessPlugin.connect(dave).reject(0)).to.be.reverted;

      // Still a member
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(true);

      // Reject it (Bob) => success
      await expect(memberAccessPlugin.connect(bob).reject(0)).to.not.be
        .reverted;

      // Still a member
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(true);

      // Try to approve it (bob) => fail
      await expect(memberAccessPlugin.connect(bob).approve(0, false)).to.be
        .reverted;

      expect((await memberAccessPlugin.getProposal(0)).executed).to.eq(false);
    });

    it("Proposals created by a non-editor need an editor's approval", async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(3);
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(false);

      await expect(
        memberAccessPlugin
          .connect(dave)
          .proposeNewMember(toUtf8Bytes('ipfs://1234'), dave.address)
      ).to.not.be.reverted;
      const pid = 0;

      const proposal = await memberAccessPlugin.getProposal(pid);
      expect(proposal.executed).to.eq(false);
      expect(proposal.parameters.minApprovals).to.eq(1);
      expect(await memberAccessPlugin.canExecute(pid)).to.eq(false);
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(false);

      // Dave cannot
      await expect(memberAccessPlugin.connect(dave).approve(pid, false)).to.be
        .reverted;
      await expect(memberAccessPlugin.connect(dave).execute(pid)).to.be
        .reverted;
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(false);

      // Alice can
      await expect(memberAccessPlugin.connect(alice).approve(pid, false)).to.not
        .be.reverted;
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(true);
    });

    it("Proposals created by an editor need another editor's approval", async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(3);

      await expect(
        memberAccessPlugin
          .connect(alice)
          .proposeNewMember(toUtf8Bytes('ipfs://1234'), dave.address)
      ).to.not.be.reverted;
      const pid = 0;

      const proposal = await memberAccessPlugin.getProposal(pid);
      expect(proposal.executed).to.eq(false);
      expect(proposal.parameters.minApprovals).to.eq(2);
      expect(await memberAccessPlugin.canExecute(pid)).to.eq(false);
    });

    it('Memberships are approved when the first non-proposer editor approves', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(3);

      // Alice proposes a mew member
      await expect(
        memberAccessPlugin
          .connect(alice)
          .proposeNewMember(toUtf8Bytes('ipfs://1234'), dave.address)
      ).to.not.be.reverted;
      let pid = 0;

      let proposal = await memberAccessPlugin.getProposal(pid);
      expect(proposal.executed).to.eq(false);

      // Approve it (Alice) => fail
      await expect(memberAccessPlugin.connect(alice).approve(pid, false)).to.be
        .reverted;

      // Approve it (Dave) => fail
      await expect(memberAccessPlugin.connect(dave).approve(pid, false)).to.be
        .reverted;

      // Approve it (Bob) => succeed
      await expect(memberAccessPlugin.connect(bob).approve(pid, false)).to.not
        .be.reverted;

      proposal = await memberAccessPlugin.getProposal(pid);
      expect(proposal.executed).to.eq(true);

      // Now Dave is a member
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(true);

      // Alice proposes aremoving a member

      await expect(
        memberAccessPlugin
          .connect(alice)
          .proposeRemoveMember(toUtf8Bytes('ipfs://1234'), dave.address)
      ).to.not.be.reverted;
      pid++;

      proposal = await memberAccessPlugin.getProposal(pid);
      expect(proposal.executed).to.eq(false);

      // Approve it (Alice) => fail
      await expect(memberAccessPlugin.connect(alice).approve(pid, false)).to.be
        .reverted;

      // Approve it (Dave) => fail
      await expect(memberAccessPlugin.connect(dave).approve(pid, false)).to.be
        .reverted;

      // Still a member
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(true);

      // Approve it (Bob) => succeed
      await expect(memberAccessPlugin.connect(bob).approve(pid, false)).to.not
        .be.reverted;

      proposal = await memberAccessPlugin.getProposal(pid);
      expect(proposal.executed).to.eq(true);

      // Now Dave is a member
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(false);
    });

    it('Memberships are rejected when the first non-proposer editor rejects', async () => {
      expect(await mainVotingPlugin.addresslistLength()).to.eq(3);

      // Alice proposes a mew member
      await expect(
        memberAccessPlugin
          .connect(alice)
          .proposeNewMember(toUtf8Bytes('ipfs://1234'), dave.address)
      ).to.not.be.reverted;
      let pid = 0;

      expect((await memberAccessPlugin.getProposal(pid)).executed).to.eq(false);

      // Reject it (Alice) => can't change
      await expect(memberAccessPlugin.connect(alice).reject(pid)).to.be
        .reverted;

      // Reject it (Dave) => fail
      await expect(memberAccessPlugin.connect(dave).reject(pid)).to.be.reverted;

      // Reject it (Bob) => succeed
      await expect(memberAccessPlugin.connect(bob).reject(pid)).to.not.be
        .reverted;

      // Reject it (Carol) => can't anymore
      await expect(memberAccessPlugin.connect(carol).reject(pid)).to.be
        .reverted;

      expect((await memberAccessPlugin.getProposal(pid)).executed).to.eq(false);

      // Dave is still not a member
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(false);

      // Alice proposes removing a member

      await dao
        .grant(mainVotingPlugin.address, dave.address, MEMBER_PERMISSION_ID)
        .then(tx => tx.wait());

      await expect(
        memberAccessPlugin
          .connect(alice)
          .proposeRemoveMember(toUtf8Bytes('ipfs://1234'), dave.address)
      ).to.not.be.reverted;
      pid++;

      expect((await memberAccessPlugin.getProposal(pid)).executed).to.eq(false);

      // Reject it (Alice) => can't change
      await expect(memberAccessPlugin.connect(alice).reject(pid)).to.be
        .reverted;

      // Reject it (Dave) => fail
      await expect(memberAccessPlugin.connect(dave).reject(pid)).to.be.reverted;

      // Still a member
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(true);

      // Reject it (Bob) => succeed
      await expect(memberAccessPlugin.connect(bob).reject(pid)).to.not.be
        .reverted;

      expect((await memberAccessPlugin.getProposal(pid)).executed).to.eq(false);

      // Still a member
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(true);

      // Reject it (Carol) => succeed
      await expect(memberAccessPlugin.connect(carol).reject(pid)).to.be
        .reverted;

      expect((await memberAccessPlugin.getProposal(pid)).executed).to.eq(false);

      // Still a member
      expect(await memberAccessPlugin.isMember(dave.address)).to.eq(true);
    });
  });

  describe('Approving', () => {
    // Alice: editor
    // Bob: member

    it('proposeNewMember should generate the right action list', async () => {
      await expect(
        memberAccessPlugin
          .connect(carol)
          .proposeNewMember(toUtf8Bytes('ipfs://1234'), carol.address)
      ).to.not.be.reverted;

      const proposal = await memberAccessPlugin.getProposal(0);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.actions[0].to).to.eq(dao.address);
      expect(proposal.actions[0].value).to.eq(0);
      expect(proposal.actions[0].data).to.eq(
        DAO__factory.createInterface().encodeFunctionData('grant', [
          mainVotingPlugin.address,
          carol.address,
          MEMBER_PERMISSION_ID,
        ])
      );
    });

    it('proposeRemoveMember should generate the right action list', async () => {
      await expect(
        memberAccessPlugin
          .connect(bob)
          .proposeRemoveMember(toUtf8Bytes('ipfs://1234'), bob.address)
      ).to.not.be.reverted;

      const proposal = await memberAccessPlugin.getProposal(0);
      expect(proposal.actions.length).to.eq(1);
      expect(proposal.actions[0].to).to.eq(dao.address);
      expect(proposal.actions[0].value).to.eq(0);
      expect(proposal.actions[0].data).to.eq(
        DAO__factory.createInterface().encodeFunctionData('revoke', [
          mainVotingPlugin.address,
          bob.address,
          MEMBER_PERMISSION_ID,
        ])
      );
    });

    it('Attempting to approve twice fails', async () => {
      await expect(
        memberAccessPlugin
          .connect(dave)
          .proposeRemoveMember(toUtf8Bytes('ipfs://1234'), bob.address)
      ).to.not.be.reverted;

      const pid = 0;
      await expect(memberAccessPlugin.approve(pid, false)).to.not.be.reverted;
      await expect(memberAccessPlugin.approve(pid, false)).to.be.reverted;
    });

    it('Attempting to reject twice fails', async () => {
      await expect(
        memberAccessPlugin
          .connect(dave)
          .proposeRemoveMember(toUtf8Bytes('ipfs://1234'), bob.address)
      ).to.not.be.reverted;

      const pid = 0;
      await expect(memberAccessPlugin.reject(pid)).to.not.be.reverted;
      await expect(memberAccessPlugin.reject(pid)).to.be.reverted;
    });

    it('Attempting to propose adding an existing member fails', async () => {
      await expect(
        memberAccessPlugin
          .connect(carol)
          .proposeNewMember(toUtf8Bytes('ipfs://1234'), alice.address)
      ).to.be.reverted;

      await expect(
        memberAccessPlugin
          .connect(bob)
          .proposeNewMember(toUtf8Bytes('ipfs://1234'), alice.address)
      ).to.be.reverted;

      await expect(
        memberAccessPlugin
          .connect(alice)
          .proposeNewMember(toUtf8Bytes('ipfs://1234'), alice.address)
      ).to.be.reverted;
    });

    it('Attempting to propose removing a non-member fails', async () => {
      await expect(
        memberAccessPlugin
          .connect(carol)
          .proposeRemoveMember(toUtf8Bytes('ipfs://1234'), carol.address)
      ).to.be.reverted;

      await expect(
        memberAccessPlugin
          .connect(bob)
          .proposeRemoveMember(toUtf8Bytes('ipfs://1234'), ADDRESS_ONE)
      ).to.be.reverted;

      await expect(
        memberAccessPlugin
          .connect(alice)
          .proposeRemoveMember(toUtf8Bytes('ipfs://1234'), ADDRESS_TWO)
      ).to.be.reverted;
    });

    it('Rejected proposals cannot be approved', async () => {
      await expect(
        memberAccessPlugin
          .connect(dave)
          .proposeRemoveMember(toUtf8Bytes('ipfs://1234'), bob.address)
      ).to.not.be.reverted;

      const pid = 0;
      await expect(memberAccessPlugin.reject(pid)).to.not.be.reverted;
      await expect(memberAccessPlugin.approve(pid, false)).to.be.reverted;
    });

    it('Rejected proposals cannot be executed', async () => {
      await expect(
        memberAccessPlugin
          .connect(dave)
          .proposeRemoveMember(toUtf8Bytes('ipfs://1234'), bob.address)
      ).to.not.be.reverted;

      const pid = 0;
      await expect(memberAccessPlugin.reject(pid)).to.not.be.reverted;
      await expect(memberAccessPlugin.execute(pid)).to.be.reverted;
    });

    it('Fails to update the settings to use an incompatible main voting plugin', async () => {
      const actionsWith = (targetAddr: string) => {
        return [
          {
            to: memberAccessPlugin.address,
            value: 0,
            data: MemberAccessPlugin__factory.createInterface().encodeFunctionData(
              'updateMultisigSettings',
              [
                {
                  proposalDuration: 60 * 60 * 24 * 5,
                  mainVotingPlugin: targetAddr,
                },
              ]
            ),
          },
        ] as IDAO.ActionStruct[];
      };

      await expect(dao.execute(ZERO_BYTES32, actionsWith(ADDRESS_ZERO), 0)).to
        .be.reverted;

      await expect(dao.execute(ZERO_BYTES32, actionsWith(ADDRESS_ONE), 0)).to.be
        .reverted;

      await expect(dao.execute(ZERO_BYTES32, actionsWith(ADDRESS_TWO), 0)).to.be
        .reverted;

      await expect(dao.execute(ZERO_BYTES32, actionsWith(bob.address), 0)).to.be
        .reverted;

      await expect(
        dao.execute(ZERO_BYTES32, actionsWith(memberAccessPlugin.address), 0)
      ).to.be.reverted;

      await expect(
        dao.execute(ZERO_BYTES32, actionsWith(mainVotingPlugin.address), 0)
      ).to.not.be.reverted;
    });

    it('Only the DAO can call the plugin to update the settings', async () => {
      // Nobody else can
      await expect(
        memberAccessPlugin.connect(alice).updateMultisigSettings({
          proposalDuration: 60 * 60 * 24 * 5,
          mainVotingPlugin: mainVotingPlugin.address,
        })
      ).to.be.reverted;
      await expect(
        memberAccessPlugin.connect(bob).updateMultisigSettings({
          proposalDuration: 60 * 60 * 24 * 5,
          mainVotingPlugin: mainVotingPlugin.address,
        })
      ).to.be.reverted;
      await expect(
        memberAccessPlugin.connect(carol).updateMultisigSettings({
          proposalDuration: 60 * 60 * 24 * 5,
          mainVotingPlugin: mainVotingPlugin.address,
        })
      ).to.be.reverted;
      await expect(
        memberAccessPlugin.connect(dave).updateMultisigSettings({
          proposalDuration: 60 * 60 * 24 * 5,
          mainVotingPlugin: mainVotingPlugin.address,
        })
      ).to.be.reverted;

      // The DAO can
      const actions: IDAO.ActionStruct[] = [
        {
          to: memberAccessPlugin.address,
          value: 0,
          data: MemberAccessPlugin__factory.createInterface().encodeFunctionData(
            'updateMultisigSettings',
            [
              {
                proposalDuration: 60 * 60 * 24 * 5,
                mainVotingPlugin: mainVotingPlugin.address,
              },
            ]
          ),
        },
      ];

      await expect(dao.execute(ZERO_BYTES32, actions, 0)).to.not.be.reverted;
    });

    it('The DAO can upgrade the plugin', async () => {
      // Nobody else can
      await expect(memberAccessPlugin.connect(alice).upgradeTo(ADDRESS_ONE)).to
        .be.reverted;
      await expect(memberAccessPlugin.connect(bob).upgradeTo(ADDRESS_ONE)).to.be
        .reverted;
      await expect(
        memberAccessPlugin.connect(carol).upgradeToAndCall(
          memberAccessPlugin.implementation(), // upgrade to itself
          EMPTY_DATA
        )
      ).to.be.reverted;
      await expect(
        memberAccessPlugin.connect(dave).upgradeToAndCall(
          memberAccessPlugin.implementation(), // upgrade to itself
          EMPTY_DATA
        )
      ).to.be.reverted;

      // The DAO can
      const actions: IDAO.ActionStruct[] = [
        {
          to: memberAccessPlugin.address,
          value: 0,
          data: MemberAccessPlugin__factory.createInterface().encodeFunctionData(
            'upgradeTo',
            [await memberAccessPlugin.implementation()]
          ),
        },
      ];

      await expect(dao.execute(ZERO_BYTES32, actions, 0)).to.not.be.reverted;
    });
  });

  describe('Tests replicated from MultisigPlugin', () => {
    describe('initialize', () => {
      it('reverts if trying to re-initialize', async () => {
        await expect(
          memberAccessPlugin.initialize(dao.address, {
            proposalDuration: 60 * 60 * 24 * 5,
            mainVotingPlugin: mainVotingPlugin.address,
          })
        ).to.be.revertedWith('Initializable: contract is already initialized');
        await expect(
          mainVotingPlugin.initialize(dao.address, defaultMainVotingSettings, [
            alice.address,
          ])
        ).to.be.revertedWith('Initializable: contract is already initialized');
        await expect(
          spacePlugin.initialize(
            dao.address,
            defaultInput.contentUri,
            ADDRESS_ZERO
          )
        ).to.be.revertedWith('Initializable: contract is already initialized');
      });

      it('should emit `MultisigSettingsUpdated` during initialization', async () => {
        memberAccessPlugin = await deployWithProxy<MemberAccessPlugin>(
          new MemberAccessPlugin__factory(alice)
        );
        const multisigSettings: MemberAccessPlugin.MultisigSettingsStruct = {
          mainVotingPlugin: mainVotingPlugin.address,
          proposalDuration: 60 * 60 * 24 * 5,
        };

        await expect(
          memberAccessPlugin.initialize(dao.address, multisigSettings)
        )
          .to.emit(memberAccessPlugin, 'MultisigSettingsUpdated')
          .withArgs(60 * 60 * 24 * 5, mainVotingPlugin.address);
      });
    });

    describe('plugin interface: ', () => {
      it('does not support the empty interface', async () => {
        expect(await memberAccessPlugin.supportsInterface('0xffffffff')).to.be
          .false;
      });

      it('supports the `IERC165Upgradeable` interface', async () => {
        const iface = IERC165Upgradeable__factory.createInterface();
        expect(
          await memberAccessPlugin.supportsInterface(getInterfaceID(iface))
        ).to.be.true;
      });

      it('supports the `IPlugin` interface', async () => {
        const iface = IPlugin__factory.createInterface();
        expect(
          await memberAccessPlugin.supportsInterface(getInterfaceID(iface))
        ).to.be.true;
      });

      it('supports the `IProposal` interface', async () => {
        const iface = IProposal__factory.createInterface();
        expect(
          await memberAccessPlugin.supportsInterface(getInterfaceID(iface))
        ).to.be.true;
      });

      it('supports the `IMultisig` interface', async () => {
        const iface = IMultisig__factory.createInterface();
        expect(
          await memberAccessPlugin.supportsInterface(getInterfaceID(iface))
        ).to.be.true;
      });

      it('supports the `Multisig` interface', async () => {
        expect(
          await memberAccessPlugin.supportsInterface(
            getInterfaceID(multisigInterface)
          )
        ).to.be.true;
      });
    });

    describe('updateMultisigSettings:', () => {
      it('should emit `MultisigSettingsUpdated` when `updateMutlsigSettings` gets called', async () => {
        await dao.grant(
          memberAccessPlugin.address,
          alice.address,
          await memberAccessPlugin.UPDATE_MULTISIG_SETTINGS_PERMISSION_ID()
        );
        const multisigSettings = {
          proposalDuration: 60 * 60 * 24 * 5,
          mainVotingPlugin: mainVotingPlugin.address,
        };

        await expect(
          memberAccessPlugin.updateMultisigSettings(multisigSettings)
        )
          .to.emit(memberAccessPlugin, 'MultisigSettingsUpdated')
          .withArgs(60 * 60 * 24 * 5, mainVotingPlugin.addAddresses);
      });
    });

    describe('createProposal:', () => {
      it('increments the proposal counter', async () => {
        expect(await memberAccessPlugin.proposalCount()).to.equal(0);

        await expect(
          memberAccessPlugin.proposeNewMember(EMPTY_DATA, carol.address)
        ).not.to.be.reverted;

        expect(await memberAccessPlugin.proposalCount()).to.equal(1);
      });

      it('creates unique proposal IDs for each proposal', async () => {
        const proposalId0 =
          await memberAccessPlugin.callStatic.proposeNewMember(
            EMPTY_DATA,
            carol.address
          );
        // create a new proposal for the proposalCounter to be incremented
        await expect(
          memberAccessPlugin.proposeNewMember(EMPTY_DATA, carol.address)
        ).not.to.be.reverted;

        const proposalId1 =
          await memberAccessPlugin.callStatic.proposeNewMember(
            EMPTY_DATA,
            dave.address
          );

        expect(proposalId0).to.equal(0); // To be removed when proposal ID is generated as a hash.
        expect(proposalId1).to.equal(1); // To be removed when proposal ID is generated as a hash.

        expect(proposalId0).to.not.equal(proposalId1);
      });

      it('emits the `ProposalCreated` event', async () => {
        await expect(
          memberAccessPlugin.proposeNewMember(EMPTY_DATA, carol.address)
        ).to.emit(memberAccessPlugin, 'ProposalCreated');
      });

      it('reverts if the multisig settings have been changed in the same block', async () => {
        await dao.grant(
          memberAccessPlugin.address,
          dao.address,
          await memberAccessPlugin.UPDATE_MULTISIG_SETTINGS_PERMISSION_ID()
        );

        await ethers.provider.send('evm_setAutomine', [false]);

        await dao.execute(
          ZERO_BYTES32,
          [
            {
              to: memberAccessPlugin.address,
              value: 0,
              data: memberAccessPlugin.interface.encodeFunctionData(
                'updateMultisigSettings',
                [
                  {
                    mainVotingPlugin: mainVotingPlugin.address,
                    proposalDuration: 60 * 60 * 24 * 5,
                  },
                ]
              ),
            },
          ],
          0
        );
        await expect(
          memberAccessPlugin.proposeNewMember(EMPTY_DATA, carol.address)
        )
          .to.revertedWithCustomError(
            memberAccessPlugin,
            'ProposalCreationForbidden'
          )
          .withArgs(alice.address);

        await ethers.provider.send('evm_setAutomine', [true]);
      });
    });

    describe('canApprove:', () => {
      let id = 0;
      beforeEach(async () => {
        await proposeNewEditor(bob.address); // have 2 editors
        await mineBlock();

        expect(await memberAccessPlugin.isEditor(alice.address)).to.be.true;
        expect(await memberAccessPlugin.isEditor(bob.address)).to.be.true;
        expect(await memberAccessPlugin.isEditor(carol.address)).to.be.false;

        // Alice approves
        await memberAccessPlugin.proposeNewMember(EMPTY_DATA, carol.address);
        id = 0;
      });

      it('returns `false` if the proposal is already executed', async () => {
        expect((await memberAccessPlugin.getProposal(id)).executed).to.be.false;
        await memberAccessPlugin.connect(bob).approve(id, false);

        expect((await memberAccessPlugin.getProposal(id)).executed).to.be.true;
        expect(await memberAccessPlugin.canApprove(id, signers[3].address)).to
          .be.false;
      });

      it('returns `false` if the approver is not an editor', async () => {
        expect(await memberAccessPlugin.isEditor(signers[9].address)).to.be
          .false;

        expect(await memberAccessPlugin.canApprove(id, signers[9].address)).to
          .be.false;
      });

      it('returns `false` if the approver has already approved', async () => {
        expect(await memberAccessPlugin.canApprove(id, bob.address)).to.be.true;
        await memberAccessPlugin.connect(bob).approve(id, false);
        expect(await memberAccessPlugin.canApprove(id, bob.address)).to.be
          .false;
      });

      it('returns `true` if the approver is listed', async () => {
        expect(await memberAccessPlugin.canApprove(id, bob.address)).to.be.true;
      });

      it('returns `false` if the proposal has ended', async () => {
        await memberAccessPlugin.proposeNewMember(EMPTY_DATA, carol.address);
        id++;

        expect(await memberAccessPlugin.canApprove(id, bob.address)).to.be.true;

        await memberAccessPlugin.connect(bob).approve(id, false);

        expect(await memberAccessPlugin.canApprove(id, bob.address)).to.be
          .false;
      });
    });

    describe('hasApproved', () => {
      let id = 0;
      beforeEach(async () => {
        await proposeNewEditor(bob.address); // have 2 editors
        await mineBlock();

        // Alice approves
        await memberAccessPlugin.proposeNewMember(EMPTY_DATA, carol.address);
        id = 0;
      });

      it("returns `false` if user hasn't approved yet", async () => {
        expect(await memberAccessPlugin.hasApproved(id, bob.address)).to.be
          .false;
      });

      it('returns `true` if user has approved', async () => {
        await memberAccessPlugin.connect(bob).approve(id, false);
        expect(await memberAccessPlugin.hasApproved(id, bob.address)).to.be
          .true;
      });
    });

    describe('approve:', () => {
      let id = 0;
      beforeEach(async () => {
        await proposeNewEditor(bob.address); // have 2 editors
        await mineBlock();

        // Alice approves
        await memberAccessPlugin.proposeNewMember(EMPTY_DATA, carol.address);
        id = 0;
      });

      it('reverts when approving multiple times', async () => {
        await memberAccessPlugin.connect(bob).approve(id, true);

        // Try to vote again
        await expect(memberAccessPlugin.connect(bob).approve(id, true))
          .to.be.revertedWithCustomError(
            memberAccessPlugin,
            'ApprovalCastForbidden'
          )
          .withArgs(id, bob.address);
      });

      it('reverts if minimal approval is not met yet', async () => {
        const proposal = await memberAccessPlugin.getProposal(id);
        expect(proposal.approvals).to.eq(1);
        await expect(memberAccessPlugin.execute(id))
          .to.be.revertedWithCustomError(
            memberAccessPlugin,
            'ProposalExecutionForbidden'
          )
          .withArgs(id);
      });

      it('approves with the msg.sender address', async () => {
        expect((await memberAccessPlugin.getProposal(id)).approvals).to.equal(
          1
        );

        const tx = await memberAccessPlugin.connect(bob).approve(id, false);

        const event = await findEvent<ApprovedEvent>(tx, 'Approved');
        expect(event!.args.proposalId).to.eq(id);
        expect(event!.args.editor).to.eq(bob.address);

        expect((await memberAccessPlugin.getProposal(id)).approvals).to.equal(
          2
        );
      });
    });

    describe('canExecute:', () => {
      let id = 0;
      beforeEach(async () => {
        await proposeNewEditor(bob.address); // have 2 editors
        await mineBlock();

        expect(await memberAccessPlugin.isEditor(alice.address)).to.be.true;
        expect(await memberAccessPlugin.isEditor(bob.address)).to.be.true;
        expect(await memberAccessPlugin.isEditor(carol.address)).to.be.false;

        // Alice approves
        await memberAccessPlugin.proposeNewMember(EMPTY_DATA, carol.address);
        id = 0;
      });

      it('returns `false` if the proposal has not reached the minimum approval yet', async () => {
        const proposal = await memberAccessPlugin.getProposal(id);
        expect(proposal.approvals).to.be.lt(proposal.parameters.minApprovals);

        expect(await memberAccessPlugin.canExecute(id)).to.be.false;
      });

      it('returns `false` if the proposal is already executed', async () => {
        expect((await memberAccessPlugin.getProposal(id)).executed).to.be.false;
        expect((await memberAccessPlugin.getProposal(id)).actions.length).to.eq(
          1
        );

        // Approve and execute
        await memberAccessPlugin.connect(bob).approve(id, false);

        expect((await memberAccessPlugin.getProposal(id)).executed).to.be.true;

        expect(await memberAccessPlugin.canExecute(id)).to.be.false;
      });
    });

    describe('execute:', () => {
      let id = 0;
      beforeEach(async () => {
        await proposeNewEditor(bob.address); // have 2 editors
        await mineBlock();

        // Alice approves
        await memberAccessPlugin.proposeNewMember(EMPTY_DATA, carol.address);
        id = 0;
      });

      it('reverts if the minimum approval is not met', async () => {
        await expect(memberAccessPlugin.execute(id))
          .to.be.revertedWithCustomError(
            memberAccessPlugin,
            'ProposalExecutionForbidden'
          )
          .withArgs(id);
      });

      it('emits the `Approved`, `ProposalExecuted`, and `Executed` events if execute is called inside the `approve` method', async () => {
        await expect(memberAccessPlugin.connect(bob).approve(id, false))
          .to.emit(dao, 'Executed')
          .to.emit(memberAccessPlugin, 'ProposalExecuted')
          .to.emit(memberAccessPlugin, 'Approved');
      });
    });
  });

  // Helpers

  const proposeNewEditor = (_editor: string, proposer = alice) => {
    const actions: IDAO.ActionStruct[] = [
      {
        to: mainVotingPlugin.address,
        value: 0,
        data: MainVotingPlugin__factory.createInterface().encodeFunctionData(
          'addAddresses',
          [[_editor]]
        ),
      },
    ];

    return mainVotingPlugin
      .connect(proposer)
      .createProposal(
        toUtf8Bytes('ipfs://'),
        actions,
        0, // fail safe
        0, // start date
        0, // end date
        VoteOption.Yes,
        true // auto execute
      )
      .then(tx => tx.wait());
  };
});
