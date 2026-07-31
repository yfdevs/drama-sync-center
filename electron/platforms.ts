import { app } from 'electron'
import path from 'node:path'
import {
  listPlatformAccountIds,
  loadPlatformAccount,
  loadPlatformEnvironmentFile,
  openPersistentPlatformSession,
  type PlatformDefinition,
  type PlatformSession,
} from '@drama-sync/platform-automation-core'
import { kuaishouPlatform } from '@drama-sync/platform-kuaishou'
import { meituanPlatform } from '@drama-sync/platform-meituan'
import { pinduoduoPlatform } from '@drama-sync/platform-pinduoduo'
import { qqShortDramaPlatform } from '@drama-sync/platform-qq-short-drama'
import { tencentVideoPlatform } from '@drama-sync/platform-tencent-video'
import { tiktokDramaPlatform } from '@drama-sync/platform-tiktok-drama'
import { weixinChannelsPlatform } from '@drama-sync/platform-weixin-channels'

export interface PlatformCatalogItem {
  accounts: Array<{
    id: string
    label: string
  }>
  authMode: PlatformDefinition['authMode']
  id: string
  loginNote: string
  name: string
  url: string
}

export interface OpenPlatformResult {
  accountId: string
  platformId: string
  profilePath: string
}

const platformDefinitions = [
  weixinChannelsPlatform,
  kuaishouPlatform,
  pinduoduoPlatform,
  meituanPlatform,
  tencentVideoPlatform,
  qqShortDramaPlatform,
  tiktokDramaPlatform,
]
const activeSessions = new Map<string, PlatformSession>()

function environmentFile(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'automation', '.env')
  }

  return path.join(process.env.APP_ROOT, '.env.production')
}

function loadEnvironment(): NodeJS.ProcessEnv {
  return loadPlatformEnvironmentFile(environmentFile())
}

export function getPlatformCatalog(): PlatformCatalogItem[] {
  const environment = loadEnvironment()

  return platformDefinitions.map((definition) => {
    const accountIds = listPlatformAccountIds(definition, environment)
    const accounts = accountIds.map((accountId) => {
      const account = loadPlatformAccount(definition, accountId, environment)
      return {
        id: account.id,
        label: account.label,
      }
    })

    return {
      accounts,
      authMode: definition.authMode,
      id: definition.id,
      loginNote: environment[`${definition.envPrefix}_LOGIN_NOTE`] ?? '',
      name: definition.name,
      url: environment[`${definition.envPrefix}_URL`] ?? '',
    }
  })
}

export async function openPlatformSession(
  platformId: string,
  accountId: string,
): Promise<OpenPlatformResult> {
  const definition = platformDefinitions.find(
    (platform) => platform.id === platformId,
  )

  if (!definition) {
    throw new Error(`Unknown platform: ${platformId}`)
  }

  const sessionKey = `${platformId}:${accountId}`
  const activeSession = activeSessions.get(sessionKey)

  if (activeSession) {
    await activeSession.page.bringToFront()
    return {
      accountId,
      platformId,
      profilePath: activeSession.profilePath,
    }
  }

  const session = await openPersistentPlatformSession(definition, accountId, {
    browsersPath: app.isPackaged
      ? path.join(process.resourcesPath, 'playwright-browsers')
      : path.join(process.env.APP_ROOT, 'build', 'playwright-browsers'),
    environment: loadEnvironment(),
    profileBaseDirectory: app.getPath('userData'),
  })
  activeSessions.set(sessionKey, session)
  session.context.once('close', () => {
    activeSessions.delete(sessionKey)
  })

  return {
    accountId,
    platformId,
    profilePath: session.profilePath,
  }
}
