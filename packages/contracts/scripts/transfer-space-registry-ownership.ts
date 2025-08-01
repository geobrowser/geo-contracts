import {ethers} from 'hardhat';
import {SpaceRegistry__factory} from '../typechain';

/**
 * Script to transfer ownership of SpaceRegistry
 * 
 * Usage:
 *   NEW_OWNER=0x... npx hardhat run scripts/transfer-space-registry-ownership.ts --network <network>
 * 
 * Prerequisites:
 *   - SPACE_REGISTRY_ADDRESS must be set in environment
 *   - NEW_OWNER must be set in environment
 *   - Caller must be the current owner
 */
async function main() {
  const [signer] = await ethers.getSigners();
  
  // Get required addresses
  const registryAddress = process.env.SPACE_REGISTRY_ADDRESS;
  const newOwner = process.env.NEW_OWNER;
  
  if (!registryAddress) {
    throw new Error('SPACE_REGISTRY_ADDRESS not set in environment');
  }
  if (!newOwner) {
    throw new Error('NEW_OWNER not set in environment');
  }
  if (!ethers.utils.isAddress(newOwner)) {
    throw new Error('NEW_OWNER is not a valid address');
  }
  
  console.log('Transferring SpaceRegistry ownership...');
  console.log('Registry address:', registryAddress);
  console.log('Current signer:', signer.address);
  console.log('New owner:', newOwner);
  
  // Connect to the registry
  const registry = SpaceRegistry__factory.connect(registryAddress, signer);
  
  // Check current ownership
  const currentOwner = await registry.owner();
  console.log('Current owner:', currentOwner);
  
  if (currentOwner !== signer.address) {
    throw new Error(`Signer ${signer.address} is not the current owner. Owner is ${currentOwner}`);
  }
  
  // Transfer ownership
  console.log('\nTransferring ownership...');
  const tx = await registry.transferOwnership(newOwner);
  console.log('Transaction hash:', tx.hash);
  
  const receipt = await tx.wait();
  console.log('Transaction confirmed in block:', receipt.blockNumber);
  
  // Verify the transfer
  const newOwnerVerified = await registry.owner();
  if (newOwnerVerified === newOwner) {
    console.log('✅ Ownership successfully transferred to:', newOwner);
  } else {
    throw new Error('Ownership transfer failed - owner is still ' + newOwnerVerified);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error.message);
    process.exit(1);
  });