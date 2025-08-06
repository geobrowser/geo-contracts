import {task} from 'hardhat/config';
import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {SpaceRegistry__factory, DAOFactory} from '../typechain';

/**
 * Space Registry Tasks
 * 
 * These tasks help manage the SpaceRegistry contract
 */

task('space-registry:create-with-id', 'Create a space with a specific ID (owner only)')
  .addParam('registry', 'SpaceRegistry contract address')
  .addParam('spaceId', 'Space ID to create (will be converted to bytes16)')
  .addParam('daoUri', 'DAO URI (e.g., ipfs://...)')
  .addParam('subdomain', 'DAO subdomain')
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    const {ethers} = hre;
    const [signer] = await ethers.getSigners();
    
    // Convert space ID to bytes16
    const spaceId = ethers.utils.formatBytes32String(taskArgs.spaceId).slice(0, 34); // bytes16 = 0x + 32 chars
    
    console.log('Creating space with specific ID...');
    console.log('Registry address:', taskArgs.registry);
    console.log('Signer:', signer.address);
    console.log('Space ID string:', taskArgs.spaceId);
    console.log('Space ID (bytes16):', spaceId);
    console.log('DAO URI:', taskArgs.daoUri);
    console.log('Subdomain:', taskArgs.subdomain);
    
    // Connect to the registry
    const registry = SpaceRegistry__factory.connect(taskArgs.registry, signer);
    
    // Check ownership
    const owner = await registry.owner();
    if (owner !== signer.address) {
      throw new Error(`Signer ${signer.address} is not the owner. Owner is ${owner}`);
    }
    
    // Check if space ID already exists
    const existingDao = await registry.daoAddressBySpaceId(spaceId);
    if (existingDao !== ethers.constants.AddressZero) {
      throw new Error(`Space ID ${spaceId} already exists with DAO ${existingDao}`);
    }
    
    // Prepare DAO settings
    const daoSettings: DAOFactory.DAOSettingsStruct = {
      daoURI: taskArgs.daoUri,
      subdomain: taskArgs.subdomain,
      trustedForwarder: ethers.constants.AddressZero,
      metadata: '0x'
    };
    
    // Plugin settings (empty for now, can be customized)
    const pluginSettings: DAOFactory.PluginSettingsStruct[] = [];
    
    // Create the space
    console.log('\nCreating space...');
    const tx = await registry.createSpaceWithId(daoSettings, pluginSettings, spaceId);
    console.log('Transaction hash:', tx.hash);
    
    const receipt = await tx.wait();
    console.log('Transaction confirmed in block:', receipt.blockNumber);
    
    // Get the created DAO address
    const createdDaoAddress = await registry.daoAddressBySpaceId(spaceId);
    console.log('✅ Space created successfully!');
    console.log('DAO address:', createdDaoAddress);
    console.log('Space ID:', spaceId);
  });

task('space-registry:check', 'Check SpaceRegistry contract information')
  .addParam('registry', 'SpaceRegistry contract address')
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    const {ethers} = hre;
    const [signer] = await ethers.getSigners();
    
    console.log('Checking SpaceRegistry...');
    console.log('Registry address:', taskArgs.registry);
    console.log('Network:', hre.network.name);
    
    // Connect to the registry
    const registry = SpaceRegistry__factory.connect(taskArgs.registry, signer);
    
    // Get basic information
    const owner = await registry.owner();
    const daoFactory = await registry.daoFactory();
    
    console.log('\nContract Information:');
    console.log('Owner:', owner);
    console.log('DAO Factory:', daoFactory);
    
    // Check if connected account has any home space
    const homeSpaceId = await registry.homeSpaceByAddress(signer.address);
    if (homeSpaceId !== '0x00000000000000000000000000000000') {
      console.log('\nYour home space ID:', homeSpaceId);
      const homeSpaceDao = await registry.daoAddressBySpaceId(homeSpaceId);
      console.log('Your home space DAO:', homeSpaceDao);
    } else {
      console.log('\nYou have no home space set');
    }
    
    // Check for pending home space requests
    const pendingSpaceId = await registry.pendingHomeSpaceId(signer.address);
    if (pendingSpaceId !== '0x00000000000000000000000000000000') {
      console.log('\nYou have a pending home space request:');
      console.log('Pending space ID:', pendingSpaceId);
      const pendingDao = await registry.daoAddressBySpaceId(pendingSpaceId);
      console.log('Pending DAO:', pendingDao);
    }
  });

task('space-registry:transfer-ownership', 'Transfer ownership of SpaceRegistry')
  .addParam('registry', 'SpaceRegistry contract address')
  .addParam('newOwner', 'Address of the new owner')
  .addFlag('execute', 'Actually execute the transfer (otherwise just simulate)')
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    const {ethers} = hre;
    const [signer] = await ethers.getSigners();
    
    console.log('SpaceRegistry Ownership Transfer');
    console.log('Registry address:', taskArgs.registry);
    console.log('Current signer:', signer.address);
    console.log('New owner:', taskArgs.newOwner);
    console.log('Mode:', taskArgs.execute ? 'EXECUTE' : 'SIMULATE');
    
    // Validate new owner address
    if (!ethers.utils.isAddress(taskArgs.newOwner)) {
      throw new Error('Invalid new owner address');
    }
    
    if (taskArgs.newOwner === ethers.constants.AddressZero) {
      throw new Error('Cannot transfer ownership to zero address');
    }
    
    // Connect to the registry
    const registry = SpaceRegistry__factory.connect(taskArgs.registry, signer);
    
    // Check current ownership
    const currentOwner = await registry.owner();
    console.log('\nCurrent owner:', currentOwner);
    
    if (currentOwner !== signer.address) {
      throw new Error(`Signer ${signer.address} is not the current owner. Current owner is ${currentOwner}`);
    }
    
    if (currentOwner === taskArgs.newOwner) {
      console.log('⚠️  New owner is the same as current owner. No transfer needed.');
      return;
    }
    
    if (!taskArgs.execute) {
      console.log('\n📋 Simulation complete. Use --execute flag to actually transfer ownership.');
      return;
    }
    
    // Execute the transfer
    console.log('\n🔄 Transferring ownership...');
    const tx = await registry.transferOwnership(taskArgs.newOwner);
    console.log('Transaction hash:', tx.hash);
    
    const receipt = await tx.wait();
    console.log('Transaction confirmed in block:', receipt.blockNumber);
    
    // Verify the transfer
    const newOwnerAfterTransfer = await registry.owner();
    if (newOwnerAfterTransfer === taskArgs.newOwner) {
      console.log('✅ Ownership successfully transferred to:', newOwnerAfterTransfer);
    } else {
      console.log('❌ Ownership transfer failed. Current owner is still:', newOwnerAfterTransfer);
    }
  });

task('space-registry:upgrade', 'Upgrade SpaceRegistry implementation')
  .addParam('registry', 'SpaceRegistry proxy address')
  .addParam('implementation', 'New implementation address')
  .addFlag('execute', 'Actually execute the upgrade (otherwise just simulate)')
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    const {ethers, upgrades} = hre;
    const [signer] = await ethers.getSigners();
    
    console.log('SpaceRegistry Upgrade');
    console.log('Proxy address:', taskArgs.registry);
    console.log('New implementation:', taskArgs.implementation);
    console.log('Signer:', signer.address);
    console.log('Mode:', taskArgs.execute ? 'EXECUTE' : 'SIMULATE');
    
    // Validate addresses
    if (!ethers.utils.isAddress(taskArgs.implementation)) {
      throw new Error('Invalid implementation address');
    }
    
    // Connect to the registry
    const registry = SpaceRegistry__factory.connect(taskArgs.registry, signer);
    
    // Check ownership
    const owner = await registry.owner();
    console.log('\nCurrent owner:', owner);
    
    if (owner !== signer.address) {
      throw new Error(`Signer ${signer.address} is not the owner. Owner is ${owner}`);
    }
    
    // Get current implementation
    const currentImpl = await upgrades.erc1967.getImplementationAddress(taskArgs.registry);
    console.log('Current implementation:', currentImpl);
    
    if (currentImpl.toLowerCase() === taskArgs.implementation.toLowerCase()) {
      console.log('⚠️  New implementation is the same as current. No upgrade needed.');
      return;
    }
    
    if (!taskArgs.execute) {
      console.log('\n📋 Simulation complete. Use --execute flag to actually perform the upgrade.');
      console.log('\nNote: Make sure the new implementation:');
      console.log('- Is a valid SpaceRegistry implementation');
      console.log('- Has been properly tested');
      console.log('- Is verified on the block explorer');
      return;
    }
    
    // Validate the new implementation
    console.log('\n🔍 Validating new implementation...');
    try {
      await upgrades.validateImplementation(
        await ethers.getContractFactory('SpaceRegistry'),
        {kind: 'uups'}
      );
      console.log('✅ Implementation validation passed');
    } catch (error) {
      console.error('❌ Implementation validation failed:', error instanceof Error ? error.message : String(error));
      throw error;
    }
    
    // Execute the upgrade
    console.log('\n🔄 Upgrading...');
    const tx = await registry.upgradeTo(taskArgs.implementation);
    console.log('Transaction hash:', tx.hash);
    
    const receipt = await tx.wait();
    console.log('Transaction confirmed in block:', receipt.blockNumber);
    
    // Verify the upgrade
    const newImpl = await upgrades.erc1967.getImplementationAddress(taskArgs.registry);
    if (newImpl.toLowerCase() === taskArgs.implementation.toLowerCase()) {
      console.log('✅ Upgrade successful! New implementation:', newImpl);
    } else {
      console.log('❌ Upgrade failed. Current implementation:', newImpl);
    }
  });