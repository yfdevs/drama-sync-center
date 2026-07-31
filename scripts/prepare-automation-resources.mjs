import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceEnv = path.join(projectRoot, '.env.production')
const resourcesDirectory = path.join(projectRoot, 'build', 'automation')

await mkdir(resourcesDirectory, { recursive: true })
await cp(sourceEnv, path.join(resourcesDirectory, '.env'))

console.log(`Automation environment prepared in ${resourcesDirectory}`)
