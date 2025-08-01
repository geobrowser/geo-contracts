// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.17;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { DAOFactory } from "@aragon/osx/framework/dao/DAOFactory.sol";
import { DAO } from "@aragon/osx/core/dao/DAO.sol";

import { ISpaceRegistry } from "./ISpaceRegistry.sol";

contract SpaceRegistry is OwnableUpgradeable, UUPSUpgradeable,ISpaceRegistry {

    DAOFactory public daoFactory;
    mapping(bytes16 => address) public daoAddressBySpaceId;
    mapping(address => bytes16) public spacesByDAOAddress;
    mapping(address => bytes16) public mainPersonalSpaceByAddress;
    mapping(address => address) public pendingMainPersonalSpaceDAOByAddress;

    event SpaceRegistryInitialized(address daoFactory, address owner);
    event SpaceRegistrySpaceCreated(bytes16 indexed spaceId, address indexed dao, address indexed creator);
    event SpaceRegistryMainPersonalSpaceUpdatePending(address indexed user, bytes16 indexed spaceId, address indexed dao);
    event SpaceRegistryMainPersonalSpaceSet(address indexed user, bytes16 indexed previousSpaceId, bytes16 indexed newSpaceId);

    error SpaceRegistryInvalidZeroAddress();
    error SpaceRegistryInvalidSpaceId(bytes16 spaceId);
    error SpaceRegistryInvalidCaller(address caller);

    function initialize(address _owner, address _daoFactory) external initializer {
        if(_daoFactory == address(0)) revert SpaceRegistryInvalidZeroAddress();

        __Ownable_init();
        _transferOwnership(_owner);
        daoFactory = DAOFactory(_daoFactory);

        emit SpaceRegistryInitialized(_daoFactory, _owner);
    }

    function createSpace(DAOFactory.DAOSettings calldata _daoSettings, DAOFactory.PluginSettings[] calldata _pluginSettings, bool _isMainPersonalSpace) external override returns (DAO createdDao, bytes16 spaceId) {
        createdDao = daoFactory.createDao(_daoSettings, _pluginSettings);
        spaceId = generateSpaceId(address(createdDao));
        daoAddressBySpaceId[spaceId] = address(createdDao);
        spacesByDAOAddress[address(createdDao)] = spaceId;

        if(_isMainPersonalSpace) {
            bytes16 previousMainPersonalSpace = mainPersonalSpaceByAddress[msg.sender];
            mainPersonalSpaceByAddress[msg.sender] = spaceId;
            emit SpaceRegistryMainPersonalSpaceSet(msg.sender, previousMainPersonalSpace, spaceId);
        }

        emit SpaceRegistrySpaceCreated(spaceId, address(createdDao), msg.sender);
    }

    function setMainPersonalSpace(bytes16 _spaceId) external override {
        address daoAddress = daoAddressBySpaceId[_spaceId];
        if (daoAddress == address(0)) revert SpaceRegistryInvalidSpaceId(_spaceId);

        pendingMainPersonalSpaceDAOByAddress[msg.sender] = daoAddress;
        emit SpaceRegistryMainPersonalSpaceUpdatePending(msg.sender, _spaceId, daoAddress);
    }

    function acceptMainPersonalSpace(address _user) external override {
        if (pendingMainPersonalSpaceDAOByAddress[_user] != msg.sender) revert SpaceRegistryInvalidCaller(msg.sender);

        bytes16 spaceId = spacesByDAOAddress[msg.sender];
        bytes16 previousMainPersonalSpace = mainPersonalSpaceByAddress[_user];
        mainPersonalSpaceByAddress[_user] = spaceId;
        delete pendingMainPersonalSpaceDAOByAddress[_user];

        emit SpaceRegistryMainPersonalSpaceSet(_user, previousMainPersonalSpace, spaceId);
    }

    function createSpaceWithId(DAOFactory.DAOSettings calldata _daoSettings, DAOFactory.PluginSettings[] calldata _pluginSettings, bytes16 _spaceId) external override onlyOwner returns (DAO createdDao) {
        createdDao = daoFactory.createDao(_daoSettings, _pluginSettings);
        daoAddressBySpaceId[_spaceId] = address(createdDao);
        spacesByDAOAddress[address(createdDao)] = _spaceId;

        emit SpaceRegistrySpaceCreated(_spaceId, address(createdDao), msg.sender);
    }

    function generateSpaceId(address _dao) public view override returns (bytes16 spaceId) {
        spaceId = bytes16(keccak256(abi.encodePacked("grc20.space", _dao, block.chainid)));
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
