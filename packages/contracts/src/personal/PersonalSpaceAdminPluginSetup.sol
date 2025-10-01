// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity ^0.8.8;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

import {PluginSetup, IPluginSetup} from "@aragon/osx/framework/plugin/setup/PluginSetup.sol";
import {IDAO} from "@aragon/osx/core/dao/IDAO.sol";
import {DAO} from "@aragon/osx/core/dao/DAO.sol";
import {PermissionLib} from "@aragon/osx/core/permission/PermissionLib.sol";
import {PersonalSpaceAdminPlugin} from "./PersonalSpaceAdminPlugin.sol";
import {EDITOR_PERMISSION_ID, MEMBER_PERMISSION_ID} from "../constants.sol";

/// @title PersonalSpaceAdminPluginSetup
/// @author Aragon - 2023
/// @notice The setup contract of the `PersonalSpaceAdminPlugin` plugin.
contract PersonalSpaceAdminPluginSetup is PluginSetup {
    using Clones for address;

    /// @notice The address of the `PersonalSpaceAdminPlugin` plugin logic contract to be cloned.
    address private immutable implementation_;

    event GeoPersonalAdminPluginCreated(address dao, address personalAdminPlugin);

    /// @notice The constructor setting the `PersonalSpaceAdminPlugin` implementation contract to clone from.
    constructor() {
        implementation_ = address(new PersonalSpaceAdminPlugin());
    }

    /// @inheritdoc IPluginSetup
    function prepareInstallation(
        address _dao,
        bytes calldata _data
    ) external returns (address plugin, PreparedSetupData memory preparedSetupData) {
        // Decode `_data` to extract the params needed for cloning and initializing the `PersonalSpaceAdminPlugin` plugin.
        (
            address[] memory initialEditors,
            address[] memory initialMembers
        ) = decodeInstallationParams(_data);

        // Clone plugin contract.
        plugin = implementation_.clone();

        // Initialize cloned plugin contract.
        PersonalSpaceAdminPlugin(plugin).initialize(IDAO(_dao), initialEditors, initialMembers);

        // Prepare permissions
        uint256 initialEditorsLength = initialEditors.length;
        uint256 initialMembersLength = initialMembers.length;
        uint256 permissionsLength = initialEditorsLength + initialMembersLength + 1;
        PermissionLib.MultiTargetPermission[]
            memory permissions = new PermissionLib.MultiTargetPermission[](permissionsLength);

        // Grant `EDITOR_PERMISSION` of the plugin to the initial editors.
        for (uint256 i; i < initialEditorsLength; ++i) {
            permissions[i] = PermissionLib.MultiTargetPermission(
                PermissionLib.Operation.Grant,
                plugin,
                initialEditors[i],
                PermissionLib.NO_CONDITION,
                EDITOR_PERMISSION_ID
            );
        }

        // Grant `MEMBER_PERMISSION` of the plugin to the initial members.
        for (uint256 j; j < initialMembersLength; ++j) {
            permissions[initialEditorsLength + j] = PermissionLib.MultiTargetPermission(
                PermissionLib.Operation.Grant,
                plugin,
                initialMembers[j],
                PermissionLib.NO_CONDITION,
                MEMBER_PERMISSION_ID
            );
        }

        // Grant `EXECUTE_PERMISSION` on the DAO to the plugin.
        permissions[permissionsLength - 1] = PermissionLib.MultiTargetPermission(
            PermissionLib.Operation.Grant,
            _dao,
            plugin,
            PermissionLib.NO_CONDITION,
            DAO(payable(_dao)).EXECUTE_PERMISSION_ID()
        );

        preparedSetupData.permissions = permissions;

        emit GeoPersonalAdminPluginCreated(_dao, plugin);
    }

    /// @inheritdoc IPluginSetup
    /// @dev There is no reliable way to revoke `EDITOR_PERMISSION_ID` or `MEMBER_PERMISSION_ID` from all addresses it has been granted to. Removing `EXECUTE_PERMISSION_ID` only, as being an editor or a member is useless without EXECUTE.
    function prepareUninstallation(
        address _dao,
        SetupPayload calldata _payload
    ) external view returns (PermissionLib.MultiTargetPermission[] memory permissions) {
        // Prepare permissions
        permissions = new PermissionLib.MultiTargetPermission[](1);

        // Revoke EXECUTE on the DAO
        permissions[0] = PermissionLib.MultiTargetPermission(
            PermissionLib.Operation.Revoke,
            _dao,
            _payload.plugin,
            PermissionLib.NO_CONDITION,
            DAO(payable(_dao)).EXECUTE_PERMISSION_ID()
        );
    }

    /// @inheritdoc IPluginSetup
    function implementation() external view returns (address) {
        return implementation_;
    }

    /// @notice Encodes the given installation parameters into a byte array
    function encodeInstallationParams(
        address[] calldata _initialEditors,
        address[] calldata _initialMembers
    ) public pure returns (bytes memory) {
        return abi.encode(_initialEditors, _initialMembers);
    }

    /// @notice Decodes the given byte array into the original installation parameters
    function decodeInstallationParams(
        bytes memory _data
    ) public pure returns (address[] memory initialEditors, address[] memory initialMembers) {
        (initialEditors, initialMembers) = abi.decode(_data, (address[], address[]));
    }
}
