import { spawn } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const browsersPath = path.join(projectRoot, 'build', 'playwright-browsers')
const require = createRequire(import.meta.url)
const playwrightPackage = require.resolve('playwright/package.json')
const playwrightCli = path.join(path.dirname(playwrightPackage), 'cli.js')

const child = spawn(
  process.execPath,
  [playwrightCli, 'install', '--no-shell', 'chromium'],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: browsersPath,
    },
    stdio: 'inherit',
    windowsHide: true,
  },
)

child.once('error', (error) => {
  console.error(error)
  process.exitCode = 1
})

child.once('exit', (code) => {
  process.exitCode = code ?? 1
})
