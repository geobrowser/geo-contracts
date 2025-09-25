import {isLocalChain} from '../../utils/hardhat';
import {DeployFunction} from 'hardhat-deploy/types';
import {HardhatRuntimeEnvironment} from 'hardhat/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts, network} = hre;
  const {deploy} = deployments;
  const {deployer} = await getNamedAccounts();

  // Skip deployment if explicitly disabled
  if (process.env.SKIP_SPACE_REGISTRY_DEPLOYMENT === 'true') {
    console.log('Skipping SpaceRegistry deployment (SKIP_SPACE_REGISTRY_DEPLOYMENT=true)');
    return;
  }

  console.log('\n===== Deploying SpaceRegistry =====');
  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer}`);

  // Get DAO Factory address
  let daoFactoryAddress: string;
  if (process.env.DAO_FACTORY_ADDRESS) {
    daoFactoryAddress = process.env.DAO_FACTORY_ADDRESS;
    console.log(`Using DAO Factory from env: ${daoFactoryAddress}`);
  } else if (isLocalChain(network.name)) {
    // For local testing, you might want to deploy a mock or use a known address
    throw new Error(
      'DAO_FACTORY_ADDRESS not set. Please provide the DAO Factory address in your .env file'
    );
  } else {
    throw new Error(
      'DAO_FACTORY_ADDRESS not set. Please provide the DAO Factory address in your .env file'
    );
  }

  // Get owner address (defaults to deployer)
  const owner = process.env.SPACE_REGISTRY_OWNER || deployer;
  console.log(`Owner will be: ${owner}`);

  // Deploy SpaceRegistry as UUPS proxy
  const spaceRegistry = await deploy('SpaceRegistry', {
    from: deployer,
    log: true,
    skipIfAlreadyDeployed: true,
    proxy: {
      proxyContract: 'UUPS',
      owner: owner, // Who can upgrade the proxy
      execute: {
        init: {
          methodName: 'initialize',
          args: [owner, daoFactoryAddress]
        }
      }
    }
  });

  if (spaceRegistry.newlyDeployed) {
    console.log(`SpaceRegistry deployed at: ${spaceRegistry.address}`);
    console.log(`- Implementation: ${spaceRegistry.implementation}`);
    console.log(`- Owner: ${owner}`);
    console.log(`- DAO Factory: ${daoFactoryAddress}`);
  } else {
    console.log(`SpaceRegistry already deployed at: ${spaceRegistry.address}`);
  }

  // Store deployment info for verification
  if (hre.managingDao) {
    // Store SpaceRegistry address if needed for other contracts
    (hre as any).spaceRegistry = {
      address: spaceRegistry.address,
      owner: owner
    };
  }
};

export default func;
// Unique tag for SpaceRegistry - not included in main 'Deployment' flow
func.tags = ['SpaceRegistry'];
// Skip function to programmatically control deployment
func.skip = async () => {
  return process.env.SKIP_SPACE_REGISTRY_DEPLOYMENT === 'true';
};