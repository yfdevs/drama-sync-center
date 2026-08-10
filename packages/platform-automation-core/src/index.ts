import { readFileSync } from 'node:fs'
import path from 'node:path'
import type {
  BrowserContext,
  BrowserType,
  Page,
} from 'playwright'
import { parse } from 'dotenv'
import { z } from 'zod'

export type PlatformAuthMode =
  | 'account-password-with-email-verification'
  | 'operator'
  | 'qq-qr-code'
  | 'qr-code'
  | 'sms-code'

export interface PlatformDefinition {
  authMode: PlatformAuthMode
  credentialFields?: readonly string[]
  envPrefix: string
  id: string
  name: string
}

export interface PlatformAccount {
  credentials: Readonly<Record<string, string>>
  id: string
  label: string
}

export interface PlatformRuntimeConfig {
  account: PlatformAccount
  loginNote: string
  profileRoot: string
  url: string
}

export interface OpenPersistentPlatformSessionOptions {
  browserOptions?: NonNullable<
    Parameters<BrowserType['launchPersistentContext']>[1]
  >
  browsersPath?: string
  environment?: NodeJS.ProcessEnv
  headless?: boolean
  profileBaseDirectory?: string
}

export interface PlatformSession {
  config: PlatformRuntimeConfig
  context: BrowserContext
  page: Page
  profilePath: string
}

const platformDefinitionSchema = z.object({
  authMode: z.enum([
    'account-password-with-email-verification',
    'operator',
    'qq-qr-code',
    'qr-code',
    'sms-code',
  ]),
  credentialFields: z.array(z.string().regex(/^[a-z][a-z0-9]*$/)).optional(),
  envPrefix: z.string().regex(/^PLATFORM_[A-Z0-9_]+$/),
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1),
})

const runtimeConfigSchema = z.object({
  loginNote: z.string().min(1),
  profileRoot: z.string().min(1),
  url: z.string().url(),
})

export function definePlatform(
  definition: PlatformDefinition,
): PlatformDefinition {
  return platformDefinitionSchema.parse(definition)
}

export function loadPlatformEnvironmentFile(envFile: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...parse(readFileSync(envFile)),
  }
}

export function loadPlatformRuntimeConfig(
  definition: PlatformDefinition,
  accountId: string,
  environment: NodeJS.ProcessEnv = process.env,
): PlatformRuntimeConfig {
  const account = loadPlatformAccount(definition, accountId, environment)
  const config = runtimeConfigSchema.parse({
    loginNote: environment[`${definition.envPrefix}_LOGIN_NOTE`],
    profileRoot: environment.PLATFORM_BROWSER_PROFILE_ROOT,
    url: environment[`${definition.envPrefix}_URL`],
  })

  return {
    ...config,
    account,
  }
}

export function listPlatformAccountIds(
  definition: PlatformDefinition,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const rawAccountIds = environment[`${definition.envPrefix}_ACCOUNT_IDS`]
  const accountIds = rawAccountIds
    ?.split(',')
    .map((accountId) => accountId.trim())
    .filter(Boolean)

  if (!accountIds?.length) {
    throw new Error(
      `Missing platform accounts: ${definition.envPrefix}_ACCOUNT_IDS`,
    )
  }

  return accountIds
}

export function loadPlatformAccount(
  definition: PlatformDefinition,
  accountId: string,
  environment: NodeJS.ProcessEnv = process.env,
): PlatformAccount {
  const accountIds = listPlatformAccountIds(definition, environment)

  if (!accountIds.includes(accountId)) {
    throw new Error(
      `Unknown account "${accountId}" for platform ${definition.name}`,
    )
  }

  const accountToken = accountId.toUpperCase().replaceAll(/[^A-Z0-9]/g, '_')
  const accountPrefix = `${definition.envPrefix}_ACCOUNT_${accountToken}`
  const credentials = Object.fromEntries(
    (definition.credentialFields ?? []).map((field) => {
      const envName = `${accountPrefix}_${field.toUpperCase()}`
      const value = environment[envName]

      if (!value) {
        throw new Error(
          `Missing environment variable ${envName} for ${definition.name}`,
        )
      }

      return [field, value]
    }),
  )

  return {
    credentials,
    id: accountId,
    label: environment[`${accountPrefix}_LABEL`] ?? accountId,
  }
}

export async function openPersistentPlatformSession(
  definition: PlatformDefinition,
  accountId: string,
  options: OpenPersistentPlatformSessionOptions = {},
): Promise<PlatformSession> {
  const config = loadPlatformRuntimeConfig(
    definition,
    accountId,
    options.environment,
  )
  const profileRoot = path.isAbsolute(config.profileRoot)
    ? config.profileRoot
    : path.resolve(
        options.profileBaseDirectory ?? process.cwd(),
        config.profileRoot,
      )
  const profilePath = path.join(profileRoot, definition.id, accountId)

  if (options.browsersPath) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = options.browsersPath
  }

  const { chromium } = await import('playwright')
  const context = await chromium.launchPersistentContext(profilePath, {
    ...options.browserOptions,
    headless: options.headless ?? false,
  })
  const page = context.pages()[0] ?? (await context.newPage())
  await page.goto(config.url)

  return {
    config,
    context,
    page,
    profilePath,
  }
}
