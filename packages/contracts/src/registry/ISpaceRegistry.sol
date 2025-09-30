// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.17;

import {DAOFactory} from "@aragon/osx/framework/dao/DAOFactory.sol";
import {DAO} from "@aragon/osx/core/dao/DAO.sol";

interface ISpaceRegistry {
    // Events

    /// @notice Emitted when the SpaceRegistry is initialized
    /// @param daoFactory The address of the DAOFactory contract
    /// @param owner The address of the owner
    event SpaceRegistryInitialized(address daoFactory, address owner);

    /// @notice Emitted when a new space is created
    /// @param spaceId The unique identifier of the created space
    /// @param dao The address of the DAO contract deployed for this space
    /// @param creator The address that created the space
    event SpaceRegistrySpaceCreated(
        bytes16 indexed spaceId,
        address indexed dao,
        address indexed creator
    );

    /// @notice Emitted when a user requests a space to become their home space
    /// @param user The address of the user making the request
    /// @param spaceId The space ID being requested as home
    /// @param dao The current DAO address of the requested space
    event SpaceRegistryHomeSpaceUpdatePending(
        address indexed user,
        bytes16 indexed spaceId,
        address indexed dao
    );

    /// @notice Emitted when a user's home space is updated
    /// @param user The address of the user whose home space changed
    /// @param previousSpaceId The previous home space ID (bytes16(0) if none)
    /// @param newSpaceId The new home space ID
    event SpaceRegistryHomeSpaceSet(
        address indexed user,
        bytes16 indexed previousSpaceId,
        bytes16 indexed newSpaceId
    );

    /// @notice Emitted when a space migrates from one DAO contract to another while keeping its space ID
    /// @param spaceId The space ID that remains constant through the migration
    /// @param oldDao The address of the previous DAO contract
    /// @param newDao The address of the new DAO contract
    event SpaceRegistrySpaceMigrated(
        bytes16 indexed spaceId,
        address indexed oldDao,
        address indexed newDao
    );

    // Errors

    /// @notice Thrown when attempting to initialize with a zero address
    error SpaceRegistryInvalidZeroAddress();

    /// @notice Thrown when referencing a space ID that doesn't exist
    /// @param spaceId The invalid space ID
    error SpaceRegistryInvalidSpaceId(bytes16 spaceId);

    /// @notice Thrown when the caller is not authorized for the operation
    /// @param caller The unauthorized caller's address
    error SpaceRegistryInvalidCaller(address caller);

    /// @notice Thrown when trying to create a space with a space ID that's already assigned to another DAO
    /// @param spaceId The already existing space ID
    error SpaceRegistrySpaceIdAlreadyExists(bytes16 spaceId);

    /// @notice Thrown when a DAO tries to accept a home space request that was never made
    /// @param user The user address for which no pending request exists
    error SpaceRegistryNoPendingRequest(address user);

    /// @notice Thrown when a user tries to request a space that is already their home space
    /// @param spaceId The space ID that is already the user's home space
    error SpaceRegistryAlreadyHomeSpace(bytes16 spaceId);

    /**
     * @notice Creates a new space by deploying a DAO, optionally setting it as the home space for the caller.
     * @dev see AragonOSX docs for more details on the DAOFactory.DAOSettings and DAOFactory.PluginSettings
     * @param _daoSettings The settings for the DAO to be created
     * @param _pluginSettings The settings for the plugins to be installed on the DAO
     * @param _isHomeSpace Whether to set the DAO as the home space for the caller
     * @return createdDao The DAO that was created
     * @return spaceId The ID of the space that was created
     */
    function createSpace(
        DAOFactory.DAOSettings calldata _daoSettings,
        DAOFactory.PluginSettings[] calldata _pluginSettings,
        bool _isHomeSpace
    ) external returns (DAO createdDao, bytes16 spaceId);

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
    function createSpaceWithId(
        DAOFactory.DAOSettings calldata _daoSettings,
        DAOFactory.PluginSettings[] calldata _pluginSettings,
        bytes16 _spaceId
    ) external returns (DAO createdDao);

    /**
     * @notice Allows a DAO to migrate its space ID to a new DAO instance
     * @dev Can only be called by an existing DAO in the registry
     * @param _daoSettings The settings for the new DAO to be created
     * @param _pluginSettings The settings for the plugins to be installed on the new DAO
     * @return newDao The new DAO that was created with the same space ID
     */
    function migrateSpace(
        DAOFactory.DAOSettings calldata _daoSettings,
        DAOFactory.PluginSettings[] calldata _pluginSettings
    ) external returns (DAO newDao);

    /**
     * @notice Generates a space ID for a given DAO address
     * @param _dao The address of the DAO to generate a space ID for
     * @return spaceId The ID of the space that was generated
     */
    function generateSpaceId(address _dao) external view returns (bytes16 spaceId);
}
