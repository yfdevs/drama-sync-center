// The Windows package includes a full Playwright Chromium runtime. electron-builder
// otherwise invokes 7-Zip with -mx=9, which can exhaust commit memory on developer
// machines while compressing the roughly 900 MB unpacked application.
process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL ??= '1'

await import('../node_modules/electron-builder/out/cli/cli.js')
