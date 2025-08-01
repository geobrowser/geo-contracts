import {ethers} from 'hardhat';
import {SpaceRegistry__factory, DAOFactory} from '../typechain';

/**
 * Script to create a space with a specific ID (owner only)
 * 
 * Usage:
 *   SPACE_ID=my-custom-space DAO_URI=ipfs://... SUBDOMAIN=custom npx hardhat run scripts/create-space-with-id.ts --network <network>
 * 
 * Prerequisites:
 *   - SPACE_REGISTRY_ADDRESS must be set in environment
 *   - SPACE_ID must be set (will be converted to bytes16)
 *   - DAO_URI must be set
 *   - SUBDOMAIN must be set
 *   - Caller must be the owner of SpaceRegistry
 */
async function main() {
  const [signer] = await ethers.getSigners();
  
  // Get required parameters
  const registryAddress = process.env.SPACE_REGISTRY_ADDRESS;
  const spaceIdString = process.env.SPACE_ID;
  const daoUri = process.env.DAO_URI;
  const subdomain = process.env.SUBDOMAIN;
  
  if (!registryAddress) {
    throw new Error('SPACE_REGISTRY_ADDRESS not set in environment');
  }
  if (!spaceIdString) {
    throw new Error('SPACE_ID not set in environment');
  }
  if (!daoUri) {
    throw new Error('DAO_URI not set in environment');
  }
  if (!subdomain) {
    throw new Error('SUBDOMAIN not set in environment');
  }
  
  // Convert space ID to bytes16
  const spaceId = ethers.utils.formatBytes32String(spaceIdString).slice(0, 34); // bytes16 = 0x + 32 chars
  
  console.log('Creating space with specific ID...');
  console.log('Registry address:', registryAddress);
  console.log('Signer:', signer.address);
  console.log('Space ID string:', spaceIdString);
  console.log('Space ID (bytes16):', spaceId);
  console.log('DAO URI:', daoUri);
  console.log('Subdomain:', subdomain);
  
  // Connect to the registry
  const registry = SpaceRegistry__factory.connect(registryAddress, signer);
  
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
    daoURI: daoUri,
    subdomain: subdomain,
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
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error.message);
    process.exit(1);
  });