import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DarenCenterClient } from './client.js'
import { loadDarenCenterConfig } from './config.js'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = path.resolve(packageRoot, '..', '..')

const client = new DarenCenterClient(
  loadDarenCenterConfig({
    envFile:
      process.env.DAREN_CENTER_ENV_FILE ??
      path.join(projectRoot, '.env.production'),
  }),
)

const loginResult = await client.login()
const currentUserResult = await client.getCurrentUser()

console.log('Daren Center API login completed', {
  loginId: loginResult.body.data?.loginId,
  loginStatus: loginResult.status,
  meStatus: currentUserResult.status,
})
