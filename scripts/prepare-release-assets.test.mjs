import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { prepareReleaseAssets } from './prepare-release-assets.mjs'

function updateInfo(arch) {
  const suffix = arch === 'arm64' ? '-arm64' : '-x64'
  return `version: 1.2.3
files:
  - url: drama-sync-center-mac-1.2.3${suffix}.zip
    sha512: zip-${arch}
    size: 100
  - url: drama-sync-center-mac-1.2.3${suffix}.dmg
    sha512: dmg-${arch}
    size: 200
path: drama-sync-center-mac-1.2.3${suffix}.zip
sha512: zip-${arch}
releaseDate: '2026-09-02T00:00:00.000Z'
`
}

void test('prepares release assets and merges macOS architecture metadata', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'drama-release-assets-'))
  context.after(() => rm(root, { force: true, recursive: true }))

  const source = path.join(root, 'downloads')
  const output = path.join(root, 'output')
  const windows = path.join(source, 'desktop-release-windows')
  const x64 = path.join(source, 'desktop-release-mac-x64')
  const arm64 = path.join(source, 'desktop-release-mac-arm64')
  await Promise.all([windows, x64, arm64].map((directory) => mkdir(directory, { recursive: true })))

  await Promise.all([
    writeFile(path.join(windows, 'drama-sync-center-setup-1.2.3.exe'), 'exe'),
    writeFile(path.join(windows, 'latest.yml'), 'version: 1.2.3\n'),
    writeFile(path.join(x64, 'drama-sync-center-mac-1.2.3-x64.dmg'), 'dmg'),
    writeFile(path.join(x64, 'drama-sync-center-mac-1.2.3-x64.zip'), 'zip'),
    writeFile(path.join(x64, 'latest-mac.yml'), updateInfo('x64')),
    writeFile(path.join(arm64, 'drama-sync-center-mac-1.2.3-arm64.dmg'), 'dmg'),
    writeFile(path.join(arm64, 'drama-sync-center-mac-1.2.3-arm64.zip'), 'zip'),
    writeFile(path.join(arm64, 'latest-mac.yml'), updateInfo('arm64')),
  ])

  await prepareReleaseAssets(source, output)

  const merged = await readFile(path.join(output, 'latest-mac.yml'), 'utf8')
  assert.match(merged, /drama-sync-center-mac-1\.2\.3-x64\.zip/)
  assert.match(merged, /drama-sync-center-mac-1\.2\.3-arm64\.zip/)
  assert.match(merged, /path: "drama-sync-center-mac-1\.2\.3-x64\.zip"/)
})
