// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity >=0.7.6;

import { DAOFactory } from "@aragon/osx/framework/dao/DAOFactory.sol";
import { DAO } from "@aragon/osx/core/dao/DAO.sol";

interface ISpaceRegistry {

    /**
     * @notice Creates a new space by deploying a DAO, optionally setting it as the home space for the caller.
     * @dev see AragonOSX docs for more details on the DAOFactory.DAOSettings and DAOFactory.PluginSettings
     * @param _daoSettings The settings for the DAO to be created
     * @param _pluginSettings The settings for the plugins to be installed on the DAO
     * @param _isHomeSpace Whether to set the DAO as the home space for the caller
     * @return createdDao The DAO that was created
     * @return spaceId The ID of the space that was created
     */
    function createSpace(DAOFactory.DAOSettings calldata _daoSettings, DAOFactory.PluginSettings[] calldata _pluginSettings, bool _isHomeSpace) external returns (DAO createdDao, bytes16 spaceId);


    /**
     * @notice Called by the user to set their home space,
     * but sets it as pending until the DAO accepts it
     * @param _spaceId The ID of the space to set as the home space
     */
    function setHomeSpace(bytes16 _spaceId) external;

    /**
     * @notice Called by a DAO to accept being the home space for a user
     * @param _user The user for whom to set the DAO as the home space
     */
    function acceptHomeSpace(address _user) external;

    /**
     * @notice Creates a new space by deploying a DAO, with a specific space ID. This function can only be called by Geo governance to migrate existing spaces.
     * @dev see AragonOSX docs for more details on the DAOFactory.DAOSettings and DAOFactory.PluginSettings
     * @param _daoSettings The settings for the DAO to be created
     * @param _pluginSettings The settings for the plugins to be installed on the DAO
     * @param _spaceId The ID of the space to create
     * @return createdDao The DAO that was created
    */
    function createSpaceWithId(DAOFactory.DAOSettings calldata _daoSettings, DAOFactory.PluginSettings[] calldata _pluginSettings, bytes16 _spaceId) external returns (DAO createdDao);

    /**
     * @notice Allows a DAO to migrate its space ID to a new DAO instance
     * @dev Can only be called by an existing DAO in the registry
     * @param _daoSettings The settings for the new DAO to be created
     * @param _pluginSettings The settings for the plugins to be installed on the new DAO
     * @return newDao The new DAO that was created with the same space ID
     */
    function migrateSpace(DAOFactory.DAOSettings calldata _daoSettings, DAOFactory.PluginSettings[] calldata _pluginSettings) external returns (DAO newDao);

    /**
     * @notice Generates a space ID for a given DAO address
     * @param _dao The address of the DAO to generate a space ID for
     * @return spaceId The ID of the space that was generated
     */
    function generateSpaceId(address _dao) external view returns (bytes16 spaceId);
}
