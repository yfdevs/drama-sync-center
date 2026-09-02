const expectedArch = process.argv[2]

if (!['arm64', 'x64'].includes(expectedArch)) {
  throw new Error('Expected architecture must be arm64 or x64')
}

if (process.platform !== 'darwin') {
  throw new Error(`macOS release must run on darwin, received ${process.platform}`)
}

if (process.arch !== expectedArch) {
  throw new Error(`Expected ${expectedArch} runner, received ${process.arch}`)
}

const requiredVariables = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
]
const missingVariables = requiredVariables.filter((name) => !process.env[name])

if (missingVariables.length > 0) {
  throw new Error(`Missing macOS release secrets: ${missingVariables.join(', ')}`)
}

console.log(`macOS ${expectedArch} signing and notarization environment is configured`)
