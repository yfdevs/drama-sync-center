import { copyFile, mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import generateIcon from 'icon-gen'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(projectRoot, 'public', 'app-logo.svg')
const output = path.join(projectRoot, 'build', 'icons')
const pngOutput = path.join(output, 'png')
const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

await generateIcon(source, output, {
  report: true,
  ico: {
    name: 'icon',
    sizes: [16, 24, 32, 48, 64, 128, 256],
  },
  icns: {
    name: 'icon',
    sizes: [16, 32, 64, 128, 256, 512, 1024],
  },
  favicon: {
    name: 'icon-',
    pngSizes,
    icoSizes: [16],
  },
})

await rm(path.join(output, 'favicon.ico'), { force: true })
await mkdir(pngOutput, { recursive: true })

await Promise.all(
  pngSizes.map((size) =>
    rename(
      path.join(output, `icon-${size}.png`),
      path.join(pngOutput, `${size}x${size}.png`),
    ),
  ),
)

await copyFile(
  path.join(pngOutput, '1024x1024.png'),
  path.join(projectRoot, 'public', 'app-logo.png'),
)

console.log(`Electron icons generated in ${path.relative(projectRoot, output)}`)
