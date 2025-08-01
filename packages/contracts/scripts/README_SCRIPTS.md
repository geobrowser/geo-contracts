# SpaceRegistry Management Scripts

This directory contains scripts for managing the SpaceRegistry contract after deployment.

## Prerequisites

All scripts require the `SPACE_REGISTRY_ADDRESS` environment variable to be set with the deployed registry address.

## Available Scripts

### 1. Check Registry State
```bash
# Basic registry info
npx hardhat run scripts/check-space-registry.ts --network sepolia

# Check specific space
CHECK_SPACE_ID=0x... npx hardhat run scripts/check-space-registry.ts --network sepolia

# Check user's home space
CHECK_USER=0x... npx hardhat run scripts/check-space-registry.ts --network sepolia

# Generate space ID for an address
GENERATE_SPACE_ID_FOR=0x... npx hardhat run scripts/check-space-registry.ts --network sepolia
```

### 2. Transfer Ownership
**⚠️ Owner only**
```bash
NEW_OWNER=0x... npx hardhat run scripts/transfer-space-registry-ownership.ts --network sepolia
```

### 3. Create Space with Specific ID
**⚠️ Owner only**
```bash
SPACE_ID=my-custom-space \
DAO_URI=ipfs://QmXxx... \
SUBDOMAIN=custom \
npx hardhat run scripts/create-space-with-id.ts --network sepolia
```

### 4. Upgrade Registry Implementation
**⚠️ Owner only**
```bash
npx hardhat run scripts/upgrade-space-registry.ts --network sepolia
```

## Environment Variables

Add these to your `.env` file:

```bash
# Required for all scripts
SPACE_REGISTRY_ADDRESS=0x...

# For ownership transfer
NEW_OWNER=0x...

# For creating space with ID
SPACE_ID=my-custom-space
DAO_URI=ipfs://...
SUBDOMAIN=custom

# For checking specific data
CHECK_SPACE_ID=0x...
CHECK_USER=0x...
GENERATE_SPACE_ID_FOR=0x...
```

## Security Notes

- Only the registry owner can:
  - Transfer ownership
  - Create spaces with specific IDs
  - Upgrade the contract implementation
- Always verify addresses before executing ownership transfers
- Test scripts on testnet first