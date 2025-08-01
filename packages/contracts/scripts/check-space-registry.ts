import {ethers} from 'hardhat';
import {SpaceRegistry__factory} from '../typechain';

/**
 * Script to check the current state of SpaceRegistry
 * 
 * Usage:
 *   npx hardhat run scripts/check-space-registry.ts --network <network>
 * 
 * Optional:
 *   CHECK_SPACE_ID=0x... - Check specific space details
 *   CHECK_USER=0x... - Check user's home space
 * 
 * Prerequisites:
 *   - SPACE_REGISTRY_ADDRESS must be set in environment
 */
async function main() {
  const [signer] = await ethers.getSigners();
  
  // Get the deployed registry address
  const registryAddress = process.env.SPACE_REGISTRY_ADDRESS;
  if (!registryAddress) {
    throw new Error('SPACE_REGISTRY_ADDRESS not set in environment');
  }
  
  console.log('Checking SpaceRegistry state...');
  console.log('Registry address:', registryAddress);
  console.log('Connected with:', signer.address);
  
  // Connect to the registry
  const registry = SpaceRegistry__factory.connect(registryAddress, signer);
  
  // Basic info
  console.log('\n=== Registry Info ===');
  const owner = await registry.owner();
  const daoFactory = await registry.daoFactory();
  console.log('Owner:', owner);
  console.log('DAO Factory:', daoFactory);
  
  // Check specific space if provided
  const checkSpaceId = process.env.CHECK_SPACE_ID;
  if (checkSpaceId) {
    console.log('\n=== Space Details ===');
    console.log('Space ID:', checkSpaceId);
    
    const daoAddress = await registry.daoAddressBySpaceId(checkSpaceId);
    if (daoAddress === ethers.constants.AddressZero) {
      console.log('Status: Space does not exist');
    } else {
      console.log('DAO Address:', daoAddress);
      
      // Verify reverse mapping
      const reverseSpaceId = await registry.spacesByDAOAddress(daoAddress);
      console.log('Reverse lookup verified:', reverseSpaceId === checkSpaceId);
    }
  }
  
  // Check user's home space if provided
  const checkUser = process.env.CHECK_USER;
  if (checkUser) {
    console.log('\n=== User Home Space ===');
    console.log('User:', checkUser);
    
    const homeSpaceId = await registry.homeSpaceByAddress(checkUser);
    if (homeSpaceId === '0x00000000000000000000000000000000') {
      console.log('Home Space: None set');
    } else {
      console.log('Home Space ID:', homeSpaceId);
      const daoAddress = await registry.daoAddressBySpaceId(homeSpaceId);
      console.log('Home Space DAO:', daoAddress);
    }
    
    // Check pending home space
    const pendingDao = await registry.pendingHomeSpaceDAOByAddress(checkUser);
    if (pendingDao !== ethers.constants.AddressZero) {
      console.log('Pending Home Space DAO:', pendingDao);
      const pendingSpaceId = await registry.spacesByDAOAddress(pendingDao);
      console.log('Pending Home Space ID:', pendingSpaceId);
    }
  }
  
  // Generate space ID for a given address
  const generateForAddress = process.env.GENERATE_SPACE_ID_FOR;
  if (generateForAddress) {
    console.log('\n=== Generate Space ID ===');
    console.log('For DAO:', generateForAddress);
    const generatedId = await registry.generateSpaceId(generateForAddress);
    console.log('Generated Space ID:', generatedId);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error.message);
    process.exit(1);
  });