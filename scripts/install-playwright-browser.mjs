import { spawn } from 'node:child_process'
import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const browsersPath = path.join(projectRoot, 'build', 'playwright-browsers')
const require = createRequire(import.meta.url)
const playwrightPackage = require.resolve('playwright/package.json')
const playwrightCli = path.join(path.dirname(playwrightPackage), 'cli.js')

async function findFile(rootDirectory, fileName) {
  let entries
  try {
    entries = await readdir(rootDirectory, { withFileTypes: true })
  } catch {
    return false
  }

  for (const entry of entries) {
    const entryPath = path.join(rootDirectory, entry.name)
    if (entry.isFile() && entry.name === fileName) {
      return true
    }
    if (entry.isDirectory() && (await findFile(entryPath, fileName))) {
      return true
    }
  }

  return false
}

async function findIncompleteChromiumInstallations() {
  let entries
  try {
    entries = await readdir(browsersPath, { withFileTypes: true })
  } catch {
    return []
  }

  const incomplete = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^chromium-\d+$/.test(entry.name)) {
      continue
    }

    const installationPath = path.join(browsersPath, entry.name)
    const executableNames = process.platform === 'win32'
      ? ['chrome.exe']
      : process.platform === 'darwin'
        // Recent Playwright Chromium builds use Chrome for Testing on macOS.
        // Keep the legacy Chromium name so existing cached installations also
        // remain valid.
        ? ['Google Chrome for Testing', 'Chromium']
        : ['chrome']
    const hasExecutable = (
      await Promise.all(executableNames.map((name) => findFile(installationPath, name)))
    ).some(Boolean)
    const hasIcuData = await findFile(installationPath, 'icudtl.dat')

    if (hasExecutable && hasIcuData) {
      continue
    }

    incomplete.push({
      path: installationPath,
      missing: [
        !hasExecutable && `Chromium executable (${executableNames.join(' or ')})`,
        !hasIcuData && 'icudtl.dat',
      ].filter(Boolean),
    })
  }

  return incomplete
}

async function removeIncompleteChromiumInstall() {
  const incomplete = await findIncompleteChromiumInstallations()
  for (const installation of incomplete) {
    console.warn(
      `Removing incomplete Playwright Chromium installation ${installation.path}; missing ${installation.missing.join(', ')}`,
    )
    await rm(installation.path, { recursive: true, force: true })
  }
}

await removeIncompleteChromiumInstall()

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

const exitCode = await new Promise((resolve) => {
  child.once('error', (error) => {
    console.error(error)
    resolve(1)
  })
  child.once('exit', (code) => resolve(code ?? 1))
})

if (exitCode !== 0) {
  process.exitCode = exitCode
} else {
  const incomplete = await findIncompleteChromiumInstallations()
  if (incomplete.length > 0) {
    const details = incomplete
      .map((installation) => `${installation.path} (missing ${installation.missing.join(', ')})`)
      .join('; ')
    console.error(`Playwright Chromium installation is incomplete: ${details}`)
    process.exitCode = 1
  }
}
