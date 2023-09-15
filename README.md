# Geo Browser - Aragon OSx

The following project contains the plugin smart contracts providing the foundation of the Geo Browser project. See `packages/contracts` and `packages/contracts-ethers`.

A template for a future JS client and a Subgraph indexer is also provided but not populated.

## Getting started

```
cp .env.template .env
```

Add your Infura API key and then, run:

```
yarn
cd packages/contracts
yarn build
yarn test
```

## Overview

A Space is composed by a DAO and several plugins installed on it. The [DAO](https://github.com/aragon/osx/blob/develop/packages/contracts/src/core/dao/DAO.sol) contract holds all the assets and rights, while plugins are custom, opt-in pieces of logic that can perform certain actions governed by the DAO's permission database.

The DAO contract can be deployed by using Aragon's DAOFactory contract. This will deploy a new DAO with the desired plugins and settings.

The current repository provides the plugins necessary to cover two use cases:

1. A standard space where members propose changes and editors vote on them
   - Space plugin
   - Personal Space Admin plugin
2. A personal space, where editors apply changes immediately
   - Space plugin
   - Member Access plugin
   - Main Voting plugin

## General notes

The implementation of the four plugins is built on top of existing and thoroughly autited plugins from Aragon OSx. The base contracts used highly align with the requirements of Geo. However, there is some cases in which certain parameters may not be relevant or may need to be kept for compatibility.

The alternative would be to fork these base contracts and include them as part of this repository. Given the pro's of getting OSx updates from Aragon for free vs the con's of keeping a few redundant parameters, we have decided to avoid forking any base contract.

[Learn more about Aragon OSx](https://devs.aragon.org/docs/osx/how-it-works/framework/).

### Quirks

- The `minProposerVotingPower` setting is ignored. Being a member is the requirement.
  - Leave it to just `0`
- The second parameter of `approve()` is ignored on `MemberAccessPlugin`. It is assumed that an approval will trigger an early execution whenever possible.
  - Leave it to just `false`
- The 4th and 5th parameters on `createProposal()` (startDate and endDate) are ignored
  - Leave them to just `0`
- `minDuration` in `MainVotingSettings` defines the proposal duration, not the minimum duration.
- The methods `addAddresses()` and `removeAddresses()` on the `MemberAccessPlugin` are disabled

## How permissions work

For each Space, an Aragon DAO is going to be created to act as the entry point. It will hold any assets and most importantly, manage the permission database which will govern all plugin interactions.

A newly deployed DAO only has a `ROOT_PERMISSION` assigned to its creator, but the DAO will typically deployed by the DAO factory, which will install all the requested plugins and drop the permission after the set up is done.

Managing permissions is made via two functions that are called on the DAO:

```solidity
function grant(address _where, address _who, bytes32 _permissionId);

function revoke(address _where, address _who, bytes32 _permissionId);
```

### Permission Conditios

For the cases where an unrestricted permission is not derisable, a [Permission Condition](https://devs.aragon.org/docs/osx/how-it-works/core/permissions/conditions) can be used. Conditional permissions are granted like this:

```solidity
function grantWithCondition(
  address _where,
  address _who,
  bytes32 _permissionId,
  IPermissionCondition _condition
);
```

See the `MemberAccessExecuteCondition` contract. It limits what the `MemberAccessPlugin` can do the DAO.

[Learn more about OSx permissions](https://devs.aragon.org/docs/osx/how-it-works/core/permissions/)

### Permissions being used

- `MEMBER_PERMISSION` is required to create proposals on the `MainVotingPlugin`
- `EDITOR_PERMISSION` is required to execute proposals on the `PersonalSpaceAdminPlugin`
- `EXECUTE_PERMISSION` is required to make the DAO `execute` a set of actions
  - Only plugins should have this permission
  - Some plugins should restrict it with a condition
- `ROOT_PERMISSION` is required to make the DAO `grant` or `revoke` permissions
  - The DAO needs to be ROOT on itself (it is by default)
  - Nobody else should be ROOT on the DAO
- `UPGRADE_PLUGIN_PERMISSION` is required for an address to be able to upgrade a plugin to a newer version published by the developer
  - Typically called by the DAO via proposal
  - Optionally granted to an additional address for convenience
- `CONTENT_PERMISSION_ID` is required to call the function that emits new events for content
  - Typically called by the DAO via proposal
- `SUBSPACE_PERMISSION_ID` is required to call the functions that accept or reject a subspace and emit the event for it
  - Typically called by the DAO via proposal
- `UPDATE_MULTISIG_SETTINGS_PERMISSION_ID` is required to change the settings of the MemberAccessPlugin
  - Typically called by the DAO via proposal
- `UPDATE_ADDRESSES_PERMISSION_ID` is required to add or remove editors on the `MainVotingPlugin`
  - Typically called by the DAO via proposal

Other DAO permissions:

- `EXECUTE_PERMISSION`
- `UPGRADE_DAO_PERMISSION`
- `SET_METADATA_PERMISSION`
- `SET_TRUSTED_FORWARDER_PERMISSION`
- `SET_SIGNATURE_VALIDATOR_PERMISSION`
- `REGISTER_STANDARD_CALLBACK_PERMISSION`

## Interacting with the contracts from JS

Run `yarn build && yarn typechain` on the `packages/contracts` folder.

See `packages/contracts/typechain` for all the generated JS/TS wrappers to interact with the contracts.

[Learn more](https://github.com/dethcrypto/TypeChain)

## Encoding and decoding actions

Making calls to the DAO is straightforward, however making execute arbitrary actions requires them to be encoded, stored on chain and be approved before they can be executed.

To this end, the DAO has a struct called `Action { to, value, data }`, which will make the DAO call the `to` address, with `value` ether and call the given calldata (if any). To encode these functions, you can make use of the provided JS client template.

It uses the generated typechain artifacts, which contain the interfaces for the available contract methods and allow to easily encode function calls into hex strings.

See `packages/js-client/src/internal/modules/encoding.ts` and `decoding.ts` for a JS boilerplate.

## Adding members and editors

On Spaces with the standard governance, a `MemberAccessPlugin` and a `MainVotingPlugin` will be installed.

### Members

- Send a transaction to call `proposeNewMember()`
- Have an editor (different to the proposer) calling `approve()` for this proposal
- This will grant a `MEMBER_PERMISSION` to the requested address

### Editors

- Have a member or editor creating a proposal
- The proposal should have an action so that the DAO `execute()`'s `addAddresses()` on the plugin
- Have a majority of editors calling `vote()` for it
- Executing `plugin.execute()` so that the DAO executes the requested action on the plugin
- The editor will be able to vote on proposals created from then on

## Adding editors (personal spaces)

- Execute a proposal with an action to call `grant(address(this), targetAddress, EDITOR_PERMISSION_ID)`
- With the permission granted, `targetAddress` can immediately start executing proposals

## The DAO's plugins

### Space plugin

Acts as the source of truth regarding the Space associated to the DAO. It is in charge of emitting the events that notify new content being approved and it also emits events accepting a certain DAO as a Subpspace.

The same plugin is used for both use cases. The difference lies on the governance model, not here.

This plugin is upgradeable.

#### Methods

- `function initialize(IDAO _dao, string _firstBlockContentUri)`
- `function setContent(uint32 _blockIndex, uint32 _itemIndex, string _contentUri)`
- `function acceptSubspace(address _dao)`
- `function removeSubspace(address _dao)`

Inherited:

- `function upgradeTo(address newImplementation)`
- `function upgradeToAndCall(address newImplementation, bytes data)`

#### Getters

Inherited:

- `function implementation() returns (address)`

#### Events

- `event ContentChanged(uint32 blockIndex, uint32 itemIndex, string contentUri)`
- `event SubspaceAccepted(address dao)`
- `event SubspaceRemoved(address dao)`

#### Permissions

- The DAO can call `setContent()` on the plugin
- The DAO can accept/remove a subspace on the plugin
- The DAO can upgrade the plugin
- Optionally, a given pluginUpgrader can upgrade the plugin

### Member Access plugin

Provides a simple way for any address to request membership on a space. It creates a proposal to grant `MEMBERSHIP_PERMISSION` to an address on the main voting plugin and Editors can approve or reject it. Once approved, the permission allows to create proposals on the other plugin.

#### Methods

- `function initialize(IDAO _dao, MultisigSettings _multisigSettings)`
- ~~`function addAddresses(address[])`~~
  - This method remains for compatibility with the base interface
- ~~`function removeAddresses(address[])`~~
  - This method remains for compatibility with the base interface
- `function updateMultisigSettings(MultisigSettings _multisigSettings)`
- `function proposeNewMember(bytes _metadata,address _proposedMember)`
- `function proposeRemoveMember(bytes _metadata,address _proposedMember)`
- `function approve(uint256 _proposalId, bool)`
  - The second parameter remains for compatibility with the base interface. However, early execution will always be made
- `function reject(uint256 _proposalId)`
- `function execute(uint256 _proposalId)`
  - This method is redundant since early execution will always trigger first

Inherited:

- `function upgradeTo(address newImplementation)`
- `function upgradeToAndCall(address newImplementation, bytes data)`

#### Getters

- `function supportsInterface(bytes4 _interfaceId) returns (bool)`
- `function canApprove(uint256 _proposalId, address _account) returns (bool)`
- `function canExecute(uint256 _proposalId) returns (bool)`
- `function getProposal(uint256 _proposalId) returns (bool executed, uint16 approvals, ProposalParameters parameters, IDAO.Action[] actions, uint256 failsafeActionMap)`
- `function hasApproved(uint256 _proposalId, address _account) returns (bool)`
- `function isMember(address _account) returns (bool)`
- `function isEditor(address _account) returns (bool)`

Inherited:

- `function proposalCount() external view returns (uint256)`
- `function implementation() returns (address)`

#### Events

- `event Approved(uint256 indexed proposalId, address indexed editor);`
- `event Rejected(uint256 indexed proposalId, address indexed editor);`
- `event MultisigSettingsUpdated(uint64 proposalDuration, address mainVotingPlugin);`

Inherited:

- `event ProposalCreated(uint256 indexed proposalId, address indexed creator, uint64 startDate, uint64 endDate, bytes metadata, IDAO.Action[] actions, uint256 allowFailureMap)`
- `event ProposalExecuted(uint256 indexed proposalId)`

#### Permissions

- Anyone can create proposals
- Editors can approve and reject proposals
- The plugin can execute on the DAO
- The DAO can update the plugin settings
- The DAO can upgrade the plugin
- Optionally, a given pluginUpgrader can upgrade the plugin

### Main Voting plugin

It's the main governance plugin for standard spaces, where all proposals are voted by editors. Only members (or editors) can create proposals and they can only be executed after a qualified majority has voted for it.

The governance settings need to be defined when the plugin is deployed but the DAO can change them at any time.

#### Methods

- `function initialize(IDAO _dao, VotingSettings calldata _votingSettings, address[] calldata _initialEditors)`
- `function addAddresses(address[])`
- `function removeAddresses(address[])`
- `function createProposal(bytes calldata metadata,IDAO.Action[] calldata actions,uint256 allowFailureMap,uint64,uint64,VoteOption voteOption,bool tryEarlyExecution)`

Inherited:

- `function vote(uint256 _proposalId, VoteOption _voteOption, bool _tryEarlyExecution)`
- `function execute(uint256 _proposalId)`
- `function updateVotingSettings(VotingSettings calldata _votingSettings)`
- `function upgradeTo(address newImplementation)`
- `function upgradeToAndCall(address newImplementation, bytes data)`

#### Getters

- `function isMember(address _account) returns (bool)`
- `function isEditor(address _account) returns (bool)`
- `function supportsInterface(bytes4 _interfaceId) returns (bool)`

Inherited:

- `function canVote(uint256 _proposalId, address _voter, VoteOption _voteOption)`
- `function getProposal(uint256 _proposalId) returns (bool open, bool executed, ProposalParameters parameters, Tally tally, IDAO.Action[] actions, uint256 allowFailureMap)`
- `function getVoteOption(uint256 _proposalId, address _voter)`
- `function isSupportThresholdReached(uint256 _proposalId) returns (bool)`
- `function isSupportThresholdReachedEarly(uint256 _proposalId)`
- `function isMinParticipationReached(uint256 _proposalId) returns (bool)`
- `function canExecute(uint256 _proposalId) returns (bool)`
- `function supportThreshold() returns (uint32)`
- `function minParticipation() returns (uint32)`
- `function minDuration() returns (uint64)`
- `function minProposerVotingPower() returns (uint256)`
- `function votingMode() returns (VotingMode)`
- `function totalVotingPower(uint256 _blockNumber) returns (uint256)`
- `function implementation() returns (address)`

#### Events

- `event Approved(uint256 indexed proposalId, address indexed editor);`
- `event Rejected(uint256 indexed proposalId, address indexed editor);`
- `event MultisigSettingsUpdated(uint64 proposalDuration, address mainVotingPlugin);`

Inherited:

- `event ProposalCreated(uint256 indexed proposalId, address indexed creator, uint64 startDate, uint64 endDate, bytes metadata, IDAO.Action[] actions, uint256 allowFailureMap)`
- `event ProposalExecuted(uint256 indexed proposalId)`

#### Permissions

- Members (and editors) can create proposals
- Editors can vote on proposals
- The plugin can execute on the DAO
- The DAO can update the plugin settings
- The DAO can manage the list of addresses
- The DAO can upgrade the plugin
- Optionally, a given pluginUpgrader can upgrade the plugin

### PersonalSpaceAdminPlugin

Governance plugin providing the default implementation for personal spaces, where addresses with editor permissioin can apply proposals right away.

Since this plugin has the power to unilaterally perform actions, it is not upgradeable. Adding many editors is possible via proposals with a grant/revoke action.

#### Methods

- `function initialize(IDAO _dao)`
- `function executeProposal(bytes calldata _metadata, IDAO.Action[] calldata _actions, uint256 _allowFailureMap)`

#### Getters

- `function isEditor(address _account) returns (bool)`
- `function supportsInterface(bytes4 _interfaceId) returns (bool)`

Inherited:

- `function proposalCount() external view returns (uint256)`
- `function implementation() returns (address)`

#### Events

Inherited:

- `event ProposalCreated(uint256 indexed proposalId, address indexed creator, uint64 startDate, uint64 endDate, bytes metadata, IDAO.Action[] actions, uint256 allowFailureMap)`
- `event ProposalExecuted(uint256 indexed proposalId)`

#### Permissions

- Editors can execute proposals right away
- The plugin can execute on the DAO

## Plugin Setup contracts

So far, we have been talking about the plugin contracts. However, they need to be prepared and installed to a DAO, and a DAO needs to approve for it. To this end, PluginSetup contracts act as an install script in charge of preparing installations, updates and uninstallations. They always have two steps:

1. An unprivileged step to prepare the plugin and request permissions
2. An approval step in which editors eventually execute an action that applies the requested installation, upgrade or uninstallation

[Learn more](https://devs.aragon.org/docs/osx/how-to-guides/plugin-development/upgradeable-plugin/setup)

### Installing plugins when deploying the DAO

This is taken care by the `DAOFactory`. The DAO creator calls `daoFactory.createDao()`:

- The call contains:
  - The DAO settings
  - An array with the details and the settings of the desired plugins
- The method will deploy a new DAO and set itself as ROOT
- It will then call `prepareInstallation()` on all plugins and `applyInstallation()` right away
- It will finally drop `ROOT_PERMISSION` on itself

[See a JS example of the flow](https://devs.aragon.org/docs/sdk/examples/client/create-dao#create-a-dao).

### Installing plugins afterwards

Plugin changes need a proposal to be passed when the DAO already exists.

1. Calling `pluginSetup.prepareInstallation()`
   - A new plugin instance is deployed with the desired settings
   - The call requests a set of permissions to be applied by the DAO
2. Editors pass a proposal to make the DAO call `applyInstallation()` on the [PluginSetupProcessor](https://devs.aragon.org/docs/osx/how-it-works/framework/plugin-management/plugin-setup/)
   - This applies the requested permissions and the plugin becomes installed

See `SpacePluginSetup`, `PersonalSpaceAdminPluginSetup`, `MemberAccessPluginSetup` and `MainVotingPluginSetup`.

[Learn more about plugin setup's](https://devs.aragon.org/docs/osx/how-it-works/framework/plugin-management/plugin-setup/).

## Deploying a DAO

The recommended way to create a DAO is by using `@aragon/sdk-client`. It uses the `DAOFactory` under the hood and it reduces the amount of low level interactions with the protocol.

[See an example](https://devs.aragon.org/docs/sdk/examples/client/create-dao).

In the example, the code is making use of the existing JS client for [Aragon's Token Voting plugin](https://github.com/aragon/sdk/tree/develop/modules/client/src/tokenVoting). They encapsulate all the Typechain and Subgraph calls and provide a high level library.

It is **recommended** to use the provided boilerplate on `packages/js-client` and adapt the existing Aragon's TokenVoting plugin to make use of the `MainVotingPlugin__factory` class.

## Plugin deployment

- The HardHat deployment scripts are located on the `packages/contracts/deploy` folder.
- The settings about the naming, ID's and versions can be found on `packages/contracts/plugin-setup-params.ts`.
- The deployments made will populate data to the `packages/contracts/plugin-repo-info.json` and `packages/contracts/plugin-repo-info-dev.json`.
- You need to copy `.env.template` into `.env` and provide your Infura API key

## DO's and DONT's

- Always grant `EDITOR_PERMISSION` without any condition attached to it
- Never grant `ROOT_PERMISSION` unless you are trying things out
- Never uninstall all plugins, as this would brick your DAO
- Ensure that there is at least always one plugin with `EXECUTE_PERMISSION` on the DAO
- Use the `_gap[]` variable for upgradeable plugins, as a way to reserve storage slots for future plugin implementations
  - Decrement the `_gap` number for every new variable you add in the future

## Plugin upgradeability

By default, only the DAO can upgrade plugins to newer versions. This requires passing a proposal. For the 3 upgradeable plugins, their plugin setup allows to pass an optional parameter to define a plugin upgrader address.

When a zero address is passed, only the DAO can call `upgradeTo()` and `upgradeToAndCall()`. When a non-zero address is passed, the desired address will be able to upgrade to whatever newer version the developer has published.

Every new version needs to be published to the plugin's repository.

[Learn more about plugin upgrades](https://devs.aragon.org/docs/osx/how-to-guides/plugin-development/upgradeable-plugin/updating-versions).
