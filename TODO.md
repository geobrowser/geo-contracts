# SpaceRegistry Improvement Plan

## Overview
This plan outlines improvements to the SpaceRegistry contract based on test coverage analysis and edge case handling.

## Task 1: Add Edge Case Handling

### 1.1 Prevent duplicate space ID creation in `createSpaceWithId`
- Add check: if space ID already exists, revert with `SpaceRegistrySpaceIdAlreadyExists(bytes16 spaceId)`
- Add test case for this scenario

### 1.2 Handle missing pending request in `acceptHomeSpace`
- Add explicit check for address(0) pending request
- Revert with `SpaceRegistryNoPendingRequest(address user)`
- Add test case for this scenario

### 1.3 Prevent redundant home space setting
- Check if requested space is already the user's home space
- Revert with `SpaceRegistryAlreadyHomeSpace(bytes16 spaceId)`
- Add test case for this scenario

### 1.4 Track pending home space requests by space ID
- Change `pendingHomeSpaceDAOByAddress` mapping to `pendingHomeSpaceId`
- Store space ID instead of DAO address
- This ensures pending requests survive space migrations
- Update `setHomeSpace` and `acceptHomeSpace` logic accordingly
- Add test case for migration with pending requests

## Task 2: Add New Error Definitions
```solidity
error SpaceRegistrySpaceIdAlreadyExists(bytes16 spaceId);
error SpaceRegistryNoPendingRequest(address user);
error SpaceRegistryAlreadyHomeSpace(bytes16 spaceId);
```

## Task 3: Update Contract Implementation
- Implement edge case handling in SpaceRegistry.sol
- Update the mapping structure for pending requests
- Ensure all error conditions are properly handled

## Task 4: Add Comprehensive Tests
- Test for duplicate space ID in `createSpaceWithId`
- Test for accepting non-existent home space request
- Test for setting current home space as home space
- Test for space migration with pending home space requests
- Test for multiple home space changes by a user
- Test for canceling pending requests by requesting different space
- Add explicit test for `generateSpaceId` function

## Task 5: Documentation Updates
- Update NatSpec comments to reflect new error conditions
- Document the behavior of pending requests during migration
- Update interface documentation if needed

## Implementation Order:
1. Add new error definitions to SpaceRegistry.sol
2. Update the pending request tracking mechanism
3. Implement edge case handling in the contract
4. Write comprehensive tests for all edge cases
5. Run tests and fix any issues
6. Update documentation

## Previous Completed Tasks:
- ✅ Rebase on latest dev branch
- ✅ Rename "main personal space" to "home space" 
- ✅ Add space migration functionality
- ✅ Update deployment infrastructure
- ✅ Run initial tests