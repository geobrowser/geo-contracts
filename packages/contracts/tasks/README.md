# SpaceRegistry Hardhat Tasks

This directory contains Hardhat tasks for managing the SpaceRegistry contract. These tasks provide a cleaner interface than environment variables for passing parameters.

## Available Tasks

### 1. Check Registry State

```bash
# Basic registry info and your home space
npx hardhat space-registry:check --registry 0x... --network sepolia
```

### 2. Create Space with Specific ID (Owner only)

```bash
npx hardhat space-registry:create-with-id \
  --registry 0x... \
  --space-id "my-custom-space" \
  --dao-uri "ipfs://QmXxx..." \
  --subdomain "custom" \
  --network sepolia
```

### 3. Transfer Ownership (Owner only)

```bash
# Simulate first (default)
npx hardhat space-registry:transfer-ownership \
  --registry 0x... \
  --new-owner 0x... \
  --network sepolia

# Execute the transfer
npx hardhat space-registry:transfer-ownership \
  --registry 0x... \
  --new-owner 0x... \
  --execute \
  --network sepolia
```

### 4. Upgrade Registry Implementation (Owner only)

```bash
# Simulate first (default)
npx hardhat space-registry:upgrade \
  --registry 0x... \
  --implementation 0x... \
  --network sepolia

# Execute the upgrade
npx hardhat space-registry:upgrade \
  --registry 0x... \
  --implementation 0x... \
  --execute \
  --network sepolia
```

## Task Parameters

All tasks use proper parameter parsing:

- Required parameters will error if not provided
- Optional parameters have sensible defaults
- Boolean flags like `--execute` are false by default
- Help is available: `npx hardhat help space-registry:check`

## Benefits over Environment Variables

1. **Better validation** - Parameters are validated before execution
2. **Built-in help** - Each task has documentation via `--help`
3. **Type safety** - Parameters are properly typed
4. **No .env pollution** - Pass parameters directly in the command
5. **Easier CI/CD** - No need to manage environment files

## Security Notes

- Owner-only tasks will verify ownership before executing
- Dangerous operations (transfer, upgrade) require `--execute` flag
- Always test on testnet first
- Double-check addresses before executing
