import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DISTRIBUTABLE_PATTERN = /\.(?:dmg|exe|zip)(?:\.blockmap)?$/i

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name)
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath]
    }),
  )
  return files.flat().sort()
}

function readScalar(value) {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return JSON.parse(trimmed)
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'")
  }
  return trimmed
}

function topLevelScalar(contents, key, source) {
  const match = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(contents)
  if (!match) throw new Error(`${source} does not contain ${key}`)
  return readScalar(match[1])
}

function parseMacUpdateInfo(contents, source) {
  const lines = contents.replaceAll('\r\n', '\n').split('\n')
  const filesIndex = lines.findIndex((line) => line === 'files:')
  if (filesIndex === -1) throw new Error(`${source} does not contain files`)

  const entries = []
  let currentLines
  for (const line of lines.slice(filesIndex + 1)) {
    if (line && !line.startsWith(' ')) break
    if (line.startsWith('  - ')) {
      if (currentLines) entries.push(currentLines)
      currentLines = [line]
    } else if (currentLines && line.startsWith('    ')) {
      currentLines.push(line)
    }
  }
  if (currentLines) entries.push(currentLines)

  const files = entries.map((entryLines) => {
    const urlMatch = /^  - url:\s*(.+)$/.exec(entryLines[0])
    const shaLine = entryLines.find((line) => /^    sha512:\s*/.test(line))
    const shaMatch = shaLine && /^    sha512:\s*(.+)$/.exec(shaLine)
    if (!urlMatch || !shaMatch) {
      throw new Error(`${source} contains an invalid file entry`)
    }
    return {
      lines: entryLines,
      sha512: readScalar(shaMatch[1]),
      url: readScalar(urlMatch[1]),
    }
  })

  if (files.length === 0) throw new Error(`${source} has no update files`)
  return { files, version: topLevelScalar(contents, 'version', source) }
}

function fileOrder(file) {
  const armOffset = file.url.includes('arm64') ? 10 : 0
  const extensionOffset = file.url.endsWith('.zip') ? 0 : file.url.endsWith('.dmg') ? 1 : 2
  return armOffset + extensionOffset
}

export function mergeMacUpdateInfo(updateFiles) {
  if (updateFiles.length !== 2) {
    throw new Error(`Expected two latest-mac.yml files, received ${updateFiles.length}`)
  }

  const versions = new Set(updateFiles.map((item) => item.version))
  if (versions.size !== 1) {
    throw new Error(`macOS update versions do not match: ${[...versions].join(', ')}`)
  }

  const filesByUrl = new Map()
  for (const updateFile of updateFiles) {
    for (const file of updateFile.files) {
      if (filesByUrl.has(file.url)) throw new Error(`Duplicate macOS update file: ${file.url}`)
      filesByUrl.set(file.url, file)
    }
  }

  const files = [...filesByUrl.values()].sort((left, right) => fileOrder(left) - fileOrder(right))
  const zipFiles = files.filter((file) => file.url.endsWith('.zip'))
  const x64Zip = zipFiles.find((file) => !file.url.includes('arm64'))
  const arm64Zip = zipFiles.find((file) => file.url.includes('arm64'))
  if (!x64Zip || !arm64Zip) {
    throw new Error('latest-mac.yml must contain both x64 and arm64 ZIP files')
  }

  return [
    `version: ${JSON.stringify(updateFiles[0].version)}`,
    'files:',
    ...files.flatMap((file) => file.lines),
    `path: ${JSON.stringify(x64Zip.url)}`,
    `sha512: ${JSON.stringify(x64Zip.sha512)}`,
    `releaseDate: ${JSON.stringify(new Date().toISOString())}`,
    '',
  ].join('\n')
}

async function ensureEmptyDirectory(directory) {
  await mkdir(directory, { recursive: true })
  const entries = await readdir(directory)
  if (entries.length > 0) throw new Error(`Output directory is not empty: ${directory}`)
}

export async function prepareReleaseAssets(sourceDirectory, outputDirectory) {
  const source = path.resolve(sourceDirectory)
  const output = path.resolve(outputDirectory)
  if (source === output || output.startsWith(`${source}${path.sep}`)) {
    throw new Error('Output directory must be outside the downloaded artifact directory')
  }

  await ensureEmptyDirectory(output)
  const sourceFiles = await listFiles(source)
  const macUpdatePaths = sourceFiles.filter((file) => path.basename(file) === 'latest-mac.yml')
  const macUpdateFiles = await Promise.all(
    macUpdatePaths.map(async (file) => ({
      ...parseMacUpdateInfo(await readFile(file, 'utf8'), file),
      source: file,
    })),
  )

  const copiedNames = new Set()
  for (const file of sourceFiles) {
    const name = path.basename(file)
    if (name === 'latest-mac.yml') continue
    if (name !== 'latest.yml' && !DISTRIBUTABLE_PATTERN.test(name)) continue
    if (copiedNames.has(name)) throw new Error(`Duplicate release asset: ${name}`)
    copiedNames.add(name)
    await copyFile(file, path.join(output, name))
  }

  await writeFile(path.join(output, 'latest-mac.yml'), mergeMacUpdateInfo(macUpdateFiles))
  copiedNames.add('latest-mac.yml')

  const requiredChecks = [
    ['Windows installer', (name) => name.endsWith('.exe')],
    ['Windows update metadata', (name) => name === 'latest.yml'],
    ['Intel macOS DMG', (name) => name.endsWith('-x64.dmg')],
    ['Apple Silicon macOS DMG', (name) => name.endsWith('-arm64.dmg')],
    ['Intel macOS ZIP', (name) => name.endsWith('-x64.zip')],
    ['Apple Silicon macOS ZIP', (name) => name.endsWith('-arm64.zip')],
  ]
  for (const [description, matches] of requiredChecks) {
    if (![...copiedNames].some(matches)) throw new Error(`Missing ${description}`)
  }

  console.log(`Prepared ${copiedNames.size} release assets in ${output}`)
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) {
  const [sourceDirectory, outputDirectory] = process.argv.slice(2)
  if (!sourceDirectory || !outputDirectory) {
    throw new Error('Usage: node scripts/prepare-release-assets.mjs <source> <output>')
  }
  await prepareReleaseAssets(sourceDirectory, outputDirectory)
}
