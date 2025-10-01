// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity 0.8.17;

import {DAO} from "@aragon/osx/core/dao/DAO.sol";
import {DAOFactory} from "@aragon/osx/framework/dao/DAOFactory.sol";

// This is a mock DAO contract that can be used for testing purposes. It
// inherits from the Aragon OSx DAO contract and provides a mock implementation
// of the metadata function.
contract MockDAO is DAO {
    // The DAO contract from Aragon OSx is abstract and does not have a
    // constructor. Therefore, this mock contract does not need to call a parent
    // constructor.

    function metadata() external view returns (string memory) {
        return "mock";
    }
}

// This is a mock DAO factory that can be used for testing purposes. It
// provides a createDao function that creates a new MockDAO contract.
contract MockDAOFactory {
    // We keep track of the created DAOs for testing purposes.
    mapping(uint256 => address) public createdDAOs;
    uint256 public daoCount;

    // The createDao function creates a new MockDAO contract and returns it.
    // It takes the same arguments as the Aragon OSx DAOFactory createDao
    // function, but it does not use them.
    function createDao(
        DAOFactory.DAOSettings calldata,
        DAOFactory.PluginSettings[] calldata
    ) external returns (DAO) {
        MockDAO dao = new MockDAO();
        createdDAOs[daoCount] = address(dao);
        daoCount++;
        return dao;
    }
}
