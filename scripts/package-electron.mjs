// The Windows package includes a full Playwright Chromium runtime. electron-builder
// otherwise invokes 7-Zip with -mx=9, which can exhaust commit memory on developer
// machines while compressing the roughly 900 MB unpacked application.
process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL ??= '1'

// Publishing is owned by .github/workflows/release.yml. On a tag build,
// electron-builder otherwise detects GitHub Actions and starts its own publisher
// before the workflow's `gh release create` step, which requires GH_TOKEN during
// the build and causes two independent publishers to race for the same release.
if (!process.argv.some((argument) => argument === '--publish' || argument.startsWith('--publish='))) {
  process.argv.push('--publish', 'never')
}

await import('../node_modules/electron-builder/out/cli/cli.js')
