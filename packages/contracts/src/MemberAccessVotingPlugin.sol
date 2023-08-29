// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity ^0.8.8;

import {SafeCastUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";

import {IDAO} from "@aragon/osx/core/dao/IDAO.sol";
import {PermissionManager} from "@aragon/osx/core/permission/PermissionManager.sol";
import {IMembership} from "@aragon/osx/core/plugin/membership/IMembership.sol";
import {PluginUUPSUpgradeable} from "@aragon/osx/core/plugin/PluginUUPSUpgradeable.sol";
import {ProposalUpgradeable} from "@aragon/osx/core/plugin/proposal/ProposalUpgradeable.sol";
import {IMultisig} from "@aragon/osx/plugins/governance/multisig/IMultisig.sol";

// import {DAO} from "@aragon/osx/core/dao/DAO.sol";
// import {Addresslist} from "@aragon/osx/plugins/utils/Addresslist.sol";

/// @title Multisig - Release 1, Build 1
/// @author Aragon Association - 2022-2023
/// @notice The on-chain multisig governance plugin in which a proposal passes if X out of Y approvals are met.
contract MemberAccessVotingPlugin is
    IMultisig,
    IMembership,
    PluginUUPSUpgradeable,
    ProposalUpgradeable
{
    using SafeCastUpgradeable for uint256;

    /// @notice The ID of the permission required to call the `addAddresses` and `removeAddresses` functions.
    bytes32 public constant UPDATE_MULTISIG_SETTINGS_PERMISSION_ID =
        keccak256("UPDATE_MULTISIG_SETTINGS_PERMISSION");

    /// @notice The ID of the permission required to create proposals on the main voting plugin.
    bytes32 public constant MEMBER_PERMISSION_ID = keccak256("MEMBER_PERMISSION");

    /// @notice The ID of the permission required to approve proposals.
    bytes32 public constant EDITOR_PERMISSION_ID = keccak256("EDITOR_PERMISSION");

    /// @notice The base amount of minimum approvals to create proposals with. May be overridden when the creator is an editor.
    uint16 internal constant MIN_APPROVALS = 1;

    /// @notice A container for proposal-related information.
    /// @param executed Whether the proposal is executed or not.
    /// @param approvals The number of approvals casted.
    /// @param parameters The proposal-specific approve settings at the time of the proposal creation.
    /// @param approvers The approves casted by the approvers.
    /// @param actions The actions to be executed when the proposal passes.
    /// @param _failsafeActionMap A bitmap allowing the proposal to succeed, even if individual actions might revert. If the bit at index `i` is 1, the proposal succeeds even if the `i`th action reverts. A failure map value of 0 requires every action to not revert.
    struct Proposal {
        bool executed;
        uint16 approvals;
        ProposalParameters parameters;
        mapping(address => bool) approvers;
        IDAO.Action[] actions;
        uint256 failsafeActionMap;
    }

    /// @notice A container for the proposal parameters.
    /// @param minApprovals The number of approvals required.
    /// @param snapshotBlock The number of the block prior to the proposal creation.
    /// @param startDate The timestamp when the proposal starts.
    /// @param endDate The timestamp when the proposal expires.
    struct ProposalParameters {
        uint16 minApprovals;
        uint64 snapshotBlock;
        uint64 startDate;
        uint64 endDate;
    }

    /// @notice A container for the plugin settings.
    /// @param proposalDuration The amount of time before a non-approved proposal expires.
    struct MultisigSettings {
        uint64 proposalDuration;
        address mainVotingPlugin;
    }

    /// @notice The [ERC-165](https://eips.ethereum.org/EIPS/eip-165) interface ID of the contract.
    bytes4 internal constant MULTISIG_INTERFACE_ID =
        this.initialize.selector ^ this.updateMultisigSettings.selector ^ this.getProposal.selector;

    /// @notice A mapping between proposal IDs and proposal information.
    mapping(uint256 => Proposal) internal proposals;

    /// @notice The current plugin settings.
    MultisigSettings public multisigSettings;

    /// @notice Keeps track at which block number the multisig settings have been changed the last time.
    /// @dev This variable prevents a proposal from being created in the same block in which the multisig settings change.
    uint64 public lastMultisigSettingsChange;

    /// @notice Thrown when a sender is not allowed to create a proposal.
    /// @param sender The sender address.
    error ProposalCreationForbidden(address sender);

    /// @notice Thrown if an approver is not allowed to cast an approve. This can be because the proposal
    /// - is not open,
    /// - was executed, or
    /// - the approver is not on the address list
    /// @param proposalId The ID of the proposal.
    /// @param sender The address of the sender.
    error ApprovalCastForbidden(uint256 proposalId, address sender);

    /// @notice Thrown if the proposal execution is forbidden.
    /// @param proposalId The ID of the proposal.
    error ProposalExecutionForbidden(uint256 proposalId);

    /// @notice Thrown when attempting to use addAddresses and removeAddresses.
    error AddresslistDisabled();

    /// @notice Emitted when a proposal is approve by an approver.
    /// @param proposalId The ID of the proposal.
    /// @param approver The approver casting the approve.
    event Approved(uint256 indexed proposalId, address indexed approver);

    /// @notice Emitted when the plugin settings are set.
    /// @param proposalDuration The amount of time before a non-approved proposal expires.
    event MultisigSettingsUpdated(uint64 proposalDuration);

    /// @notice Initializes Release 1, Build 1.
    /// @dev This method is required to support [ERC-1822](https://eips.ethereum.org/EIPS/eip-1822).
    /// @param _dao The IDAO interface of the associated DAO.
    /// @param _multisigSettings The multisig settings.
    function initialize(
        IDAO _dao,
        MultisigSettings calldata _multisigSettings
    ) external initializer {
        __PluginUUPSUpgradeable_init(_dao);

        _updateMultisigSettings(_multisigSettings);
    }

    /// @notice Checks if this or the parent contract supports an interface by its ID.
    /// @param _interfaceId The ID of the interface.
    /// @return Returns `true` if the interface is supported.
    function supportsInterface(
        bytes4 _interfaceId
    ) public view virtual override(PluginUUPSUpgradeable, ProposalUpgradeable) returns (bool) {
        return
            _interfaceId == MULTISIG_INTERFACE_ID ||
            _interfaceId == type(IMultisig).interfaceId ||
            _interfaceId == type(IMembership).interfaceId ||
            super.supportsInterface(_interfaceId);
    }

    /// @notice This function is kept for compatibility with the multisig base class, but will not produce any effect.
    function addAddresses(
        address[] calldata
    ) external view auth(UPDATE_MULTISIG_SETTINGS_PERMISSION_ID) {
        revert AddresslistDisabled();
    }

    /// @notice This function is kept for compatibility with the multisig base class, but will not produce any effect.
    function removeAddresses(
        address[] calldata
    ) external view auth(UPDATE_MULTISIG_SETTINGS_PERMISSION_ID) {
        revert AddresslistDisabled();
    }

    /// @notice Updates the plugin settings.
    /// @param _multisigSettings The new settings.
    function updateMultisigSettings(
        MultisigSettings calldata _multisigSettings
    ) external auth(UPDATE_MULTISIG_SETTINGS_PERMISSION_ID) {
        _updateMultisigSettings(_multisigSettings);
    }

    /// @notice Creates a new multisig proposal wrapped by proposeNewMember and proposeRemoveMember.
    /// @param _metadata The metadata of the proposal.
    /// @param _actions A list of actions wrapped by proposeNewMember and proposeRemoveMember.
    /// @param _isEditor Whether the proposal creator is an editor or not.
    /// @return proposalId The ID of the proposal.
    function createProposal(
        bytes calldata _metadata,
        IDAO.Action[] memory _actions,
        bool _isEditor
    ) internal returns (uint256 proposalId) {
        uint64 snapshotBlock;
        unchecked {
            snapshotBlock = block.number.toUint64() - 1; // The snapshot block must be mined already to protect the transaction against backrunning transactions causing census changes.
        }

        // Revert if the settings have been changed in the same block as this proposal should be created in.
        // This prevents a malicious party from voting with previous addresses and the new settings.
        if (lastMultisigSettingsChange > snapshotBlock) {
            revert ProposalCreationForbidden(_msgSender());
        }

        uint64 _startDate = block.timestamp.toUint64();
        uint64 _endDate = _startDate + multisigSettings.proposalDuration;

        proposalId = _createProposalId();

        emit ProposalCreated({
            proposalId: proposalId,
            creator: _msgSender(),
            metadata: _metadata,
            startDate: _startDate,
            endDate: _endDate,
            actions: _actions,
            allowFailureMap: uint8(0)
        });

        // Create the proposal
        Proposal storage proposal_ = proposals[proposalId];

        proposal_.parameters.snapshotBlock = snapshotBlock;
        proposal_.parameters.startDate = _startDate;
        proposal_.parameters.endDate = _endDate;

        // May be overridden below
        proposal_.parameters.minApprovals = MIN_APPROVALS;

        for (uint256 i; i < _actions.length; ) {
            proposal_.actions.push(_actions[i]);
            unchecked {
                ++i;
            }
        }

        if (_isEditor) {
            // If the creator is an editor, we assume that the editor approves
            // and we require one more approval
            proposal_.parameters.minApprovals = MIN_APPROVALS + 1;

            approve(proposalId, false);
        }
    }

    /// @notice Creates a proposal to add a new member.
    /// @param _metadata The metadata of the proposal.
    /// @param _proposedMember The address of the member who may eveutnally be added.
    /// @return proposalId The ID of the proposal.
    function proposeNewMember(
        bytes calldata _metadata,
        address _proposedMember
    ) external returns (uint256 proposalId) {
        // Build the list of actions
        IDAO.Action[] memory _actions = new IDAO.Action[](1);

        _actions[0] = IDAO.Action({
            to: address(dao()),
            value: 0,
            data: abi.encodeWithSelector(
                PermissionManager.grant.selector, // grant()
                multisigSettings.mainVotingPlugin, // where
                _proposedMember, // who
                MEMBER_PERMISSION_ID // permission ID
            )
        });

        bool isEditor = dao().hasPermission(
            _msgSender(),
            address(this),
            EDITOR_PERMISSION_ID,
            bytes("")
        );

        return createProposal(_metadata, _actions, isEditor);
    }

    /// @notice Creates a proposal to remove an existing member.
    /// @param _metadata The metadata of the proposal.
    /// @param _proposedMember The address of the member who may eveutnally be removed.
    /// @return proposalId The ID of the proposal.
    function proposeRemoveMember(
        bytes calldata _metadata,
        address _proposedMember
    ) external returns (uint256 proposalId) {
        // Build the list of actions
        IDAO.Action[] memory _actions = new IDAO.Action[](1);

        _actions[0] = IDAO.Action({
            to: address(dao()),
            value: 0,
            data: abi.encodeWithSelector(
                PermissionManager.revoke.selector, // revoke()
                multisigSettings.mainVotingPlugin, // where
                _proposedMember, // who
                MEMBER_PERMISSION_ID // permission ID
            )
        });

        bool isEditor = dao().hasPermission(
            _msgSender(),
            address(this),
            EDITOR_PERMISSION_ID,
            bytes("")
        );

        return createProposal(_metadata, _actions, isEditor);
    }

    /// @inheritdoc IMultisig
    function approve(uint256 _proposalId, bool _tryExecution) public {
        address approver = _msgSender();
        if (!_canApprove(_proposalId, approver)) {
            revert ApprovalCastForbidden(_proposalId, approver);
        }

        Proposal storage proposal_ = proposals[_proposalId];

        // As the list can never become more than type(uint16).max(due to addAddresses check)
        // It's safe to use unchecked as it would never overflow.
        unchecked {
            proposal_.approvals += 1;
        }

        proposal_.approvers[approver] = true;

        emit Approved({proposalId: _proposalId, approver: approver});

        if (_tryExecution && _canExecute(_proposalId)) {
            _execute(_proposalId);
        }
    }

    /// @inheritdoc IMultisig
    function canApprove(uint256 _proposalId, address _account) external view returns (bool) {
        return _canApprove(_proposalId, _account);
    }

    /// @inheritdoc IMultisig
    function canExecute(uint256 _proposalId) external view returns (bool) {
        return _canExecute(_proposalId);
    }

    /// @notice Returns all information for a proposal vote by its ID.
    /// @param _proposalId The ID of the proposal.
    /// @return executed Whether the proposal is executed or not.
    /// @return approvals The number of approvals casted.
    /// @return parameters The parameters of the proposal vote.
    /// @return actions The actions to be executed in the associated DAO after the proposal has passed.
    /// @param failsafeActionMap A bitmap allowing the proposal to succeed, even if individual actions might revert. If the bit at index `i` is 1, the proposal succeeds even if the `i`th action reverts. A failure map value of 0 requires every action to not revert.
    function getProposal(
        uint256 _proposalId
    )
        public
        view
        returns (
            bool executed,
            uint16 approvals,
            ProposalParameters memory parameters,
            IDAO.Action[] memory actions,
            uint256 failsafeActionMap
        )
    {
        Proposal storage proposal_ = proposals[_proposalId];

        executed = proposal_.executed;
        approvals = proposal_.approvals;
        parameters = proposal_.parameters;
        actions = proposal_.actions;
        failsafeActionMap = proposal_.failsafeActionMap;
    }

    /// @inheritdoc IMultisig
    function hasApproved(uint256 _proposalId, address _account) public view returns (bool) {
        return proposals[_proposalId].approvers[_account];
    }

    /// @inheritdoc IMultisig
    function execute(uint256 _proposalId) public {
        if (!_canExecute(_proposalId)) {
            revert ProposalExecutionForbidden(_proposalId);
        }

        _execute(_proposalId);
    }

    /// @inheritdoc IMembership
    function isMember(address _account) external view returns (bool) {
        return dao().hasPermission(address(this), _account, EDITOR_PERMISSION_ID, bytes(""));
    }

    /// @notice Internal function to execute a vote. It assumes the queried proposal exists.
    /// @param _proposalId The ID of the proposal.
    function _execute(uint256 _proposalId) internal {
        Proposal storage proposal_ = proposals[_proposalId];

        proposal_.executed = true;

        _executeProposal(
            dao(),
            _proposalId,
            proposals[_proposalId].actions,
            proposals[_proposalId].failsafeActionMap
        );
    }

    /// @notice Internal function to check if an account can approve. It assumes the queried proposal exists.
    /// @param _proposalId The ID of the proposal.
    /// @param _account The account to check.
    /// @return Returns `true` if the given account can approve on a certain proposal and `false` otherwise.
    function _canApprove(uint256 _proposalId, address _account) internal view returns (bool) {
        Proposal storage proposal_ = proposals[_proposalId];

        if (!_isProposalOpen(proposal_)) {
            // The proposal was executed already
            return false;
        }

        if (!dao().hasPermission(address(this), _account, EDITOR_PERMISSION_ID, bytes(""))) {
            // The approver has no voting power.
            return false;
        }

        if (proposal_.approvers[_account]) {
            // The approver has already approved
            return false;
        }

        return true;
    }

    /// @notice Internal function to check if a proposal can be executed. It assumes the queried proposal exists.
    /// @param _proposalId The ID of the proposal.
    /// @return Returns `true` if the proposal can be executed and `false` otherwise.
    function _canExecute(uint256 _proposalId) internal view returns (bool) {
        Proposal storage proposal_ = proposals[_proposalId];

        // Verify that the proposal has not been executed or expired.
        if (!_isProposalOpen(proposal_)) {
            return false;
        }

        return proposal_.approvals >= proposal_.parameters.minApprovals;
    }

    /// @notice Internal function to check if a proposal vote is still open.
    /// @param proposal_ The proposal struct.
    /// @return True if the proposal vote is open, false otherwise.
    function _isProposalOpen(Proposal storage proposal_) internal view returns (bool) {
        uint64 currentTimestamp64 = block.timestamp.toUint64();
        return
            !proposal_.executed &&
            proposal_.parameters.startDate <= currentTimestamp64 &&
            proposal_.parameters.endDate >= currentTimestamp64;
    }

    /// @notice Internal function to update the plugin settings.
    /// @param _multisigSettings The new settings.
    function _updateMultisigSettings(MultisigSettings calldata _multisigSettings) internal {
        multisigSettings = _multisigSettings;
        lastMultisigSettingsChange = block.number.toUint64();

        emit MultisigSettingsUpdated({proposalDuration: _multisigSettings.proposalDuration});
    }

    /// @dev This empty reserved space is put in place to allow future versions to add new
    /// variables without shifting down storage in the inheritance chain.
    /// https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
    uint256[50] private __gap;
}
