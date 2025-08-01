import {ethers, upgrades} from 'hardhat';

/**
 * Script to upgrade SpaceRegistry to a new implementation
 * 
 * Usage:
 *   npx hardhat run scripts/upgrade-space-registry.ts --network <network>
 * 
 * Prerequisites:
 *   - SPACE_REGISTRY_ADDRESS must be set in environment
 *   - Caller must be the owner of the SpaceRegistry
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  
  // Get the deployed registry address
  const registryAddress = process.env.SPACE_REGISTRY_ADDRESS;
  if (!registryAddress) {
    throw new Error('SPACE_REGISTRY_ADDRESS not set in environment');
  }
  
  console.log('Upgrading SpaceRegistry...');
  console.log('Registry address:', registryAddress);
  console.log('Deployer/Owner:', deployer.address);
  
  // Get the existing registry
  const SpaceRegistry = await ethers.getContractFactory('SpaceRegistry');
  const registry = SpaceRegistry.attach(registryAddress);
  
  // Check ownership
  const owner = await registry.owner();
  if (owner !== deployer.address) {
    throw new Error(`Deployer ${deployer.address} is not the owner. Owner is ${owner}`);
  }
  
  // Deploy new implementation and upgrade
  console.log('Deploying new implementation...');
  const upgradedRegistry = await upgrades.upgradeProxy(registryAddress, SpaceRegistry);
  
  console.log('Upgrade transaction hash:', upgradedRegistry.deployTransaction.hash);
  await upgradedRegistry.deployed();
  
  console.log('SpaceRegistry upgraded successfully!');
  
  // Verify the upgrade
  const newImplementation = await upgrades.erc1967.getImplementationAddress(registryAddress);
  console.log('New implementation address:', newImplementation);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });