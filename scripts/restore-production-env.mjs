import { writeFile } from 'node:fs/promises'
import path from 'node:path'

const encoded = process.env.PRODUCTION_ENV_BASE64?.replaceAll(/\s/g, '')

if (!encoded) {
  throw new Error('Repository secret PRODUCTION_ENV_BASE64 is not configured')
}

if (!/^[A-Za-z\d+/]*={0,2}$/.test(encoded)) {
  throw new Error('PRODUCTION_ENV_BASE64 is not valid Base64')
}

const contents = Buffer.from(encoded, 'base64')
if (contents.length === 0) {
  throw new Error('PRODUCTION_ENV_BASE64 decoded to an empty file')
}

const output = path.resolve('.env.production')
await writeFile(output, contents, { mode: 0o600 })
console.log(`Restored ${path.basename(output)} (${contents.length} bytes)`)
