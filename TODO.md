# SpaceRegistry Refactoring Plan

## Overview
This plan outlines the changes needed to:
1. Rename "main personal space" to "home space" throughout the codebase
2. Add space migration functionality

## Task 0: Rebase on latest dev branch
- Fetch the latest `dev` branch from origin
- Rebase the current branch (`pcv/space-factory`) on top of `dev`
- Resolve any merge conflicts that arise
- The dev branch contains fixes for running tests locally

## Task 1: Rename "main personal space" to "home space"

### Variables to rename:
- `mainPersonalSpaceByAddress` → `homeSpaceByAddress`
- `pendingMainPersonalSpaceDAOByAddress` → `pendingHomeSpaceDAOByAddress`
- `_isMainPersonalSpace` parameter → `_isHomeSpace`
- `previousMainPersonalSpace` local variable → `previousHomeSpace`

### Functions to rename:
- `setMainPersonalSpace()` → `setHomeSpace()`
- `acceptMainPersonalSpace()` → `acceptHomeSpace()`

### Events to rename:
- `SpaceRegistryMainPersonalSpaceUpdatePending` → `SpaceRegistryHomeSpaceUpdatePending`
- `SpaceRegistryMainPersonalSpaceSet` → `SpaceRegistryHomeSpaceSet`

### Documentation updates:
- Update all comments and NatSpec documentation to use "home space" terminology

## Task 2: Add space migration functionality

### New function: `migrateSpace()`
```solidity
function migrateSpace(
    DAOFactory.DAOSettings calldata _daoSettings,
    DAOFactory.PluginSettings[] calldata _pluginSettings
) external returns (DAO newDao);
```

#### Requirements:
- Only callable by the DAO itself (msg.sender must be an existing DAO in the registry)
- Retrieves the space ID associated with the calling DAO
- Creates a new DAO with the provided settings
- Updates mappings to point the space ID to the new DAO
- Removes the old DAO from the reverse mapping
- Preserves home space associations if applicable

### New event:
```solidity
event SpaceRegistrySpaceMigrated(
    bytes16 indexed spaceId,
    address indexed oldDao,
    address indexed newDao
);
```

### Interface update:
Add the `migrateSpace` function signature to `ISpaceRegistry.sol`

## Implementation Order:
1. Fetch and rebase on latest dev branch
2. Update interface first (ISpaceRegistry.sol)
3. Rename all "main personal space" references to "home space"
4. Implement the migrateSpace function
5. Update tests to reflect new naming and functionality
6. Ensure compilation and all tests pass
7. Create/modify deployment scripts for SpaceRegistry
8. Update README.md with SpaceRegistry documentation
9. Update README_DEPLOYMENT.md with deployment instructions

## Task 3: Update deployment infrastructure ✅

### Deployment script:
- ✅ Create or modify deployment scripts to deploy SpaceRegistry independently
- ✅ Ensure the script can be run separately from other contract deployments
- ✅ Configure proper initialization parameters (owner, DAOFactory address)
- ✅ Created management scripts for post-deployment tasks

## Task 4: Update documentation

### README.md updates:
- Add a section explaining the SpaceRegistry contract
- Document the concept of spaces and home spaces
- Explain the space creation and migration process
- Include usage examples

### README_DEPLOYMENT.md updates:
- Add deployment instructions for SpaceRegistry
- Include required environment variables and parameters
- Document the deployment order and dependencies
- Add verification steps for successful deployment

## Task 5: Run tests

### Prerequisites:
- Fix yarn install issue (environment configuration for Geo chain)
- Ensure proper .env setup

### Testing steps:
- Run `yarn install` successfully
- Run `yarn build` in packages/contracts
- Run `yarn test` to execute all tests
- Verify SpaceRegistry tests pass
- Fix any compilation or test failures

## Testing Considerations:
- Test that only DAOs can call migrateSpace
- Test that space ID is preserved during migration
- Test that home space associations are maintained
- Test error cases (non-existent DAO, etc.)