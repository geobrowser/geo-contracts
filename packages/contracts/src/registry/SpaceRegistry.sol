// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.17;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { DAOFactory } from "@aragon/osx/framework/dao/DAOFactory.sol";
import { DAO } from "@aragon/osx/core/dao/DAO.sol";

import { ISpaceRegistry } from "./ISpaceRegistry.sol";

/// @title SpaceRegistry
/// @notice Central registry and factory for deploying and managing spaces (DAOs)
/// @dev This contract serves as the entry point for creating new spaces by deploying DAO contracts.
///      Each space has a unique ID that maps to a DAO contract address. Users can designate one space
///      as their "home space". To set an existing space as home, users must request it and the 
///      space's DAO must accept. Spaces can migrate to new DAO contracts while keeping their ID.
contract SpaceRegistry is OwnableUpgradeable, UUPSUpgradeable,ISpaceRegistry {

    /// @notice The DAOFactory contract used to deploy new DAO instances
    DAOFactory public daoFactory;
    
    /// @notice Maps each unique space ID to its current DAO contract address
    mapping(bytes16 => address) public daoAddressBySpaceId;
    
    /// @notice Reverse mapping: DAO address to its space ID
    mapping(address => bytes16) public spacesByDAOAddress;
    
    /// @notice The home space ID for each user address (bytes16(0) if none)
    mapping(address => bytes16) public homeSpaceByAddress;
    
    /// @notice Pending home space requests: user address to requested space ID
    /// @dev When a user wants to set an existing space as home, the space ID is stored here
    ///      until the space's DAO accepts. Using space IDs (not DAO addresses) ensures 
    ///      requests remain valid if the space migrates to a new DAO contract.
    mapping(address => bytes16) public pendingHomeSpaceId;

    /// @notice Initializes the SpaceRegistry contract
    /// @param _owner The address that will own this registry contract
    /// @param _daoFactory The address of the DAOFactory contract used to deploy spaces
    function initialize(address _owner, address _daoFactory) external initializer {
        if(_daoFactory == address(0)) revert SpaceRegistryInvalidZeroAddress();

        __Ownable_init();
        _transferOwnership(_owner);
        daoFactory = DAOFactory(_daoFactory);

        emit SpaceRegistryInitialized(_daoFactory, _owner);
    }

    /// @inheritdoc ISpaceRegistry
    function createSpace(DAOFactory.DAOSettings calldata _daoSettings, DAOFactory.PluginSettings[] calldata _pluginSettings, bool _isHomeSpace) external override returns (DAO createdDao, bytes16 spaceId) {
        createdDao = daoFactory.createDao(_daoSettings, _pluginSettings);
        spaceId = generateSpaceId(address(createdDao));
        daoAddressBySpaceId[spaceId] = address(createdDao);
        spacesByDAOAddress[address(createdDao)] = spaceId;

        if(_isHomeSpace) {
            bytes16 previousHomeSpace = homeSpaceByAddress[msg.sender];
            homeSpaceByAddress[msg.sender] = spaceId;
            emit SpaceRegistryHomeSpaceSet(msg.sender, previousHomeSpace, spaceId);
        }

        emit SpaceRegistrySpaceCreated(spaceId, address(createdDao), msg.sender);
    }

    /// @inheritdoc ISpaceRegistry
    function setHomeSpace(bytes16 _spaceId) external override {
        address daoAddress = daoAddressBySpaceId[_spaceId];
        if (daoAddress == address(0)) revert SpaceRegistryInvalidSpaceId(_spaceId);
        
        // Check if already home space
        if (homeSpaceByAddress[msg.sender] == _spaceId) revert SpaceRegistryAlreadyHomeSpace(_spaceId);

        pendingHomeSpaceId[msg.sender] = _spaceId;
        emit SpaceRegistryHomeSpaceUpdatePending(msg.sender, _spaceId, daoAddress);
    }

    /// @inheritdoc ISpaceRegistry
    function acceptHomeSpace(address _user) external override {
        bytes16 pendingSpaceId = pendingHomeSpaceId[_user];
        if (pendingSpaceId == bytes16(0)) revert SpaceRegistryNoPendingRequest(_user);
        
        // Verify the caller is the DAO for this space ID
        if (daoAddressBySpaceId[pendingSpaceId] != msg.sender) revert SpaceRegistryInvalidCaller(msg.sender);

        bytes16 previousHomeSpace = homeSpaceByAddress[_user];
        homeSpaceByAddress[_user] = pendingSpaceId;
        delete pendingHomeSpaceId[_user];

        emit SpaceRegistryHomeSpaceSet(_user, previousHomeSpace, pendingSpaceId);
    }

    /// @inheritdoc ISpaceRegistry
    function createSpaceWithId(DAOFactory.DAOSettings calldata _daoSettings, DAOFactory.PluginSettings[] calldata _pluginSettings, bytes16 _spaceId) external override onlyOwner returns (DAO createdDao) {
        // Check if space ID already exists
        if (daoAddressBySpaceId[_spaceId] != address(0)) revert SpaceRegistrySpaceIdAlreadyExists(_spaceId);
        
        createdDao = daoFactory.createDao(_daoSettings, _pluginSettings);
        daoAddressBySpaceId[_spaceId] = address(createdDao);
        spacesByDAOAddress[address(createdDao)] = _spaceId;

        emit SpaceRegistrySpaceCreated(_spaceId, address(createdDao), msg.sender);
    }

    /// @inheritdoc ISpaceRegistry
    function migrateSpace(DAOFactory.DAOSettings calldata _daoSettings, DAOFactory.PluginSettings[] calldata _pluginSettings) external override returns (DAO newDao) {
        // Check that the caller is a DAO registered in the system
        bytes16 spaceId = spacesByDAOAddress[msg.sender];
        if (spaceId == bytes16(0)) revert SpaceRegistryInvalidCaller(msg.sender);

        // Create the new DAO
        newDao = daoFactory.createDao(_daoSettings, _pluginSettings);
        
        // Update mappings: remove old DAO, add new DAO with same space ID
        delete spacesByDAOAddress[msg.sender];
        daoAddressBySpaceId[spaceId] = address(newDao);
        spacesByDAOAddress[address(newDao)] = spaceId;

        emit SpaceRegistrySpaceMigrated(spaceId, msg.sender, address(newDao));
    }

    /// @inheritdoc ISpaceRegistry
    function generateSpaceId(address _dao) public view override returns (bytes16 spaceId) {
        spaceId = bytes16(keccak256(abi.encodePacked("grc20.space", _dao, block.chainid)));
    }

    /// @notice Authorizes an upgrade to a new implementation
    /// @dev Can only be called by the owner as part of the UUPS upgrade pattern
    /// @param newImplementation The address of the new implementation contract
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
