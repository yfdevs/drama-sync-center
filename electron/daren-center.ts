import { app } from 'electron'
import path from 'node:path'
import {
  DarenCenterClient,
  loadDarenCenterConfig,
  type LoginData,
  type RequestResult,
} from '@drama-sync/daren-center-automation'
import { logger } from './logger'

let client: DarenCenterClient | undefined

function environmentFile(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'automation', '.env')
  }

  return path.join(process.env.APP_ROOT, '.env.production')
}

function getClient(): DarenCenterClient {
  if (!client) {
    client = new DarenCenterClient(
      loadDarenCenterConfig({
        envFile: environmentFile(),
      }),
    )
  }

  return client
}

export async function loginToDarenCenter(): Promise<RequestResult<LoginData>> {
  logger.info('Starting Daren Center API login')
  const result = await getClient().login()
  logger.info('Daren Center API login completed', {
    loginId: result.body.data?.loginId,
    status: result.status,
  })
  return result
}

export async function getDarenCenterCurrentUser(): Promise<RequestResult<unknown>> {
  const result = await getClient().getCurrentUser()
  logger.info('Daren Center current-user request completed', {
    status: result.status,
  })
  return result
}
