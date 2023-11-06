// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity ^0.8.8;

import {PermissionLib} from "@aragon/osx/core/permission/PermissionLib.sol";
import {DAO} from "@aragon/osx/core/dao/DAO.sol";
import {PluginSetup, IPluginSetup} from "@aragon/osx/framework/plugin/setup/PluginSetup.sol";
import {MemberAccessPlugin} from "./MemberAccessPlugin.sol";
import {MemberAccessExecuteCondition} from "./MemberAccessExecuteCondition.sol";
import {MainVotingPlugin} from "./MainVotingPlugin.sol";
import {MajorityVotingBase} from "@aragon/osx/plugins/governance/majority-voting/MajorityVotingBase.sol";

/// @title GovernancePluginsSetup
/// @dev Release 1, Build 1
contract GovernancePluginsSetup is PluginSetup {
    address private immutable memberAccessPluginImplementation;
    address private immutable mainVotingPluginImplementation;

    constructor() {
        memberAccessPluginImplementation = address(new MemberAccessPlugin());
        mainVotingPluginImplementation = address(new MainVotingPlugin());
    }

    /// @inheritdoc IPluginSetup
    /// @notice Prepares the installation of the two governance plugins in one go
    function prepareInstallation(
        address _dao,
        bytes memory _data
    ) external returns (address mainVotingPlugin, PreparedSetupData memory preparedSetupData) {
        // Decode the custom installation parameters
        (
            MajorityVotingBase.VotingSettings memory _votingSettings,
            address[] memory _initialEditors,
            uint64 _memberAccessProposalDuration,
            address _pluginUpgrader
        ) = abi.decode(_data, (MajorityVotingBase.VotingSettings, address[], uint64, address));

        // Deploy the main voting plugin
        mainVotingPlugin = createERC1967Proxy(
            mainVotingPluginImplementation,
            abi.encodeWithSelector(
                MainVotingPlugin.initialize.selector,
                _dao,
                _votingSettings,
                _initialEditors
            )
        );

        // Deploy the member access plugin
        MemberAccessPlugin.MultisigSettings memory _multisigSettings;
        _multisigSettings.proposalDuration = _memberAccessProposalDuration;
        _multisigSettings.mainVotingPlugin = MainVotingPlugin(mainVotingPlugin);

        address _memberAccessPlugin = createERC1967Proxy(
            memberAccessPluginImplementation,
            abi.encodeWithSelector(MemberAccessPlugin.initialize.selector, _dao, _multisigSettings)
        );

        // Condition contract (member access plugin execute)
        address conditionContract = address(new MemberAccessExecuteCondition(mainVotingPlugin));

        // List the requested permissions
        PermissionLib.MultiTargetPermission[]
            memory permissions = new PermissionLib.MultiTargetPermission[](
                _pluginUpgrader == address(0x0) ? 7 : 9
            );

        // The main voting plugin can execute on the DAO
        permissions[0] = PermissionLib.MultiTargetPermission({
            operation: PermissionLib.Operation.Grant,
            where: _dao,
            who: mainVotingPluginImplementation,
            condition: PermissionLib.NO_CONDITION,
            permissionId: DAO(payable(_dao)).EXECUTE_PERMISSION_ID()
        });
        // The DAO can update the main voting plugin settings
        permissions[1] = PermissionLib.MultiTargetPermission({
            operation: PermissionLib.Operation.Grant,
            where: mainVotingPluginImplementation,
            who: _dao,
            condition: PermissionLib.NO_CONDITION,
            permissionId: MainVotingPlugin(mainVotingPluginImplementation)
                .UPDATE_VOTING_SETTINGS_PERMISSION_ID()
        });
        // The DAO can manage the list of addresses
        permissions[2] = PermissionLib.MultiTargetPermission({
            operation: PermissionLib.Operation.Grant,
            where: mainVotingPluginImplementation,
            who: _dao,
            condition: PermissionLib.NO_CONDITION,
            permissionId: MainVotingPlugin(mainVotingPluginImplementation)
                .UPDATE_ADDRESSES_PERMISSION_ID()
        });
        // The DAO can upgrade the main voting plugin
        permissions[3] = PermissionLib.MultiTargetPermission({
            operation: PermissionLib.Operation.Grant,
            where: mainVotingPluginImplementation,
            who: _dao,
            condition: PermissionLib.NO_CONDITION,
            permissionId: MainVotingPlugin(mainVotingPluginImplementation)
                .UPGRADE_PLUGIN_PERMISSION_ID()
        });

        // The member access plugin needs to execute on the DAO
        permissions[4] = PermissionLib.MultiTargetPermission({
            operation: PermissionLib.Operation.Grant,
            where: _dao,
            who: _memberAccessPlugin,
            condition: conditionContract,
            permissionId: DAO(payable(_dao)).EXECUTE_PERMISSION_ID()
        });

        // The DAO needs to be able to update the member access plugin settings
        permissions[5] = PermissionLib.MultiTargetPermission({
            operation: PermissionLib.Operation.Grant,
            where: _memberAccessPlugin,
            who: _dao,
            condition: PermissionLib.NO_CONDITION,
            permissionId: MemberAccessPlugin(memberAccessPluginImplementation)
                .UPDATE_MULTISIG_SETTINGS_PERMISSION_ID()
        });

        // The DAO needs to be able to upgrade the member access plugin
        permissions[6] = PermissionLib.MultiTargetPermission({
            operation: PermissionLib.Operation.Grant,
            where: _memberAccessPlugin,
            who: _dao,
            condition: PermissionLib.NO_CONDITION,
            permissionId: MemberAccessPlugin(memberAccessPluginImplementation)
                .UPGRADE_PLUGIN_PERMISSION_ID()
        });

        // pluginUpgrader needs to be able to upgrade the plugins
        if (_pluginUpgrader != address(0x0)) {
            permissions[7] = PermissionLib.MultiTargetPermission({
                operation: PermissionLib.Operation.Grant,
                where: mainVotingPluginImplementation,
                who: _pluginUpgrader,
                condition: PermissionLib.NO_CONDITION,
                permissionId: MainVotingPlugin(mainVotingPluginImplementation)
                    .UPGRADE_PLUGIN_PERMISSION_ID()
            });
            permissions[8] = PermissionLib.MultiTargetPermission({
                operation: PermissionLib.Operation.Grant,
                where: _memberAccessPlugin,
                who: _pluginUpgrader,
                condition: PermissionLib.NO_CONDITION,
                permissionId: MemberAccessPlugin(memberAccessPluginImplementation)
                    .UPGRADE_PLUGIN_PERMISSION_ID()
            });
        }

        preparedSetupData.permissions = permissions;
        preparedSetupData.helpers = new address[](1);
        preparedSetupData.helpers[0] = _memberAccessPlugin;
    }

    /// @inheritdoc IPluginSetup
    function prepareUninstallation(
        address _dao,
        SetupPayload calldata _payload
    ) external view returns (PermissionLib.MultiTargetPermission[] memory permissionChanges) {
        // Decode incoming params
        address _pluginUpgrader = abi.decode(_payload.data, (address));

        permissionChanges = new PermissionLib.MultiTargetPermission[](
            _pluginUpgrader == address(0x0) ? 7 : 9
        );

        // Main voting plugin permissions

        // The plugin can no longer execute on the DAO
        permissionChanges[0] = PermissionLib.MultiTargetPermission({
            operation: PermissionLib.Operation.Revoke,
            where: _dao,
            who: _payload.plugin,
            condition: PermissionLib.NO_CONDITION,
            permissionId: DAO(payable(_dao)).EXECUTE_PERMISSION_ID()
        });
        // The DAO can no longer update the plugin settings
        permissionChanges[1] = PermissionLib.MultiTargetPermission({
            operation: PermissionLib.Operation.Revoke,
            where: _payload.plugin,
            who: _dao,
            condition: PermissionLib.NO_CONDITION,
            permissionId: MainVotingPlugin(mainVotingPluginImplementation)
                .UPDATE_VOTING_SETTINGS_PERMISSION_ID()
        });
        // The DAO can no longer manage the list of addresses
        permissionChanges[2] = PermissionLib.MultiTargetPermission({
            operation: PermissionLib.Operation.Revoke,
            where: _payload.plugin,
            who: _dao,
            condition: PermissionLib.NO_CONDITION,
            permissionId: MainVotingPlugin(mainVotingPluginImplementation)
                .UPDATE_ADDRESSES_PERMISSION_ID()
        });
        // The DAO can no longer upgrade the plugin
        permissionChanges[3] = PermissionLib.MultiTargetPermission({
            operation: PermissionLib.Operation.Revoke,
            where: _payload.plugin,
            who: _dao,
            condition: PermissionLib.NO_CONDITION,
            permissionId: MainVotingPlugin(mainVotingPluginImplementation)
                .UPGRADE_PLUGIN_PERMISSION_ID()
        });

        // Member access plugin permissions

        // The plugin can no longer execute on the DAO
        permissionChanges[4] = PermissionLib.MultiTargetPermission({
            operation: PermissionLib.Operation.Revoke,
            where: _dao,
            who: _payload.plugin,
            condition: PermissionLib.NO_CONDITION,
            permissionId: DAO(payable(_dao)).EXECUTE_PERMISSION_ID()
        });
        // The DAO can no longer update the plugin settings
        permissionChanges[5] = PermissionLib.MultiTargetPermission({
            operation: PermissionLib.Operation.Revoke,
            where: _payload.plugin,
            who: _dao,
            condition: PermissionLib.NO_CONDITION,
            permissionId: MemberAccessPlugin(memberAccessPluginImplementation)
                .UPDATE_MULTISIG_SETTINGS_PERMISSION_ID()
        });
        // The DAO can no longer upgrade the plugin
        permissionChanges[6] = PermissionLib.MultiTargetPermission({
            operation: PermissionLib.Operation.Revoke,
            where: _payload.plugin,
            who: _dao,
            condition: PermissionLib.NO_CONDITION,
            permissionId: MemberAccessPlugin(memberAccessPluginImplementation)
                .UPGRADE_PLUGIN_PERMISSION_ID()
        });

        if (_pluginUpgrader != address(0x0)) {
            // pluginUpgrader can no longer upgrade the plugins
            permissionChanges[7] = PermissionLib.MultiTargetPermission({
                operation: PermissionLib.Operation.Revoke,
                where: _payload.plugin,
                who: _pluginUpgrader,
                condition: PermissionLib.NO_CONDITION,
                permissionId: MainVotingPlugin(mainVotingPluginImplementation)
                    .UPGRADE_PLUGIN_PERMISSION_ID()
            });
            permissionChanges[8] = PermissionLib.MultiTargetPermission({
                operation: PermissionLib.Operation.Revoke,
                where: _payload.plugin,
                who: _pluginUpgrader,
                condition: PermissionLib.NO_CONDITION,
                permissionId: MemberAccessPlugin(memberAccessPluginImplementation)
                    .UPGRADE_PLUGIN_PERMISSION_ID()
            });
        }
    }

    /// @inheritdoc IPluginSetup
    function implementation() external view returns (address) {
        return memberAccessPluginImplementation;
    }
}
