import { config as loadEnvFile } from 'dotenv'

export interface DarenCenterConfig {
  baseUrl: string
  password: string
  timeoutMs: number
  username: string
}

export interface LoadConfigOptions {
  envFile?: string
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

function parseTimeout(value: string | undefined): number {
  const timeout = Number(value ?? 30_000)

  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error('DAREN_CENTER_TIMEOUT_MS must be a positive number')
  }

  return timeout
}

export function loadDarenCenterConfig(options: LoadConfigOptions = {}): DarenCenterConfig {
  if (options.envFile) {
    const result = loadEnvFile({
      override: false,
      path: options.envFile,
      quiet: true,
    })

    if (result.error) {
      throw new Error(
        `Unable to load Daren Center environment file: ${options.envFile}: ${result.error.message}`,
      )
    }
  }

  const baseUrl = requiredEnvironmentVariable('DAREN_CENTER_BASE_URL')

  try {
    new URL(baseUrl)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`DAREN_CENTER_BASE_URL must be a valid URL: ${reason}`)
  }

  return {
    baseUrl,
    password: requiredEnvironmentVariable('DAREN_CENTER_PASSWORD'),
    timeoutMs: parseTimeout(process.env.DAREN_CENTER_TIMEOUT_MS),
    username: requiredEnvironmentVariable('DAREN_CENTER_USERNAME'),
  }
}
