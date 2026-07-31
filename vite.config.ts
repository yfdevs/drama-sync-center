import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, lazyPlugins } from 'vite-plus'
import { notBundle } from 'vite-plugin-electron/plugin'

const platformPackageBuildTasks = [
  '@drama-sync/platform-automation-core#build',
  '@drama-sync/platform-kuaishou#build',
  '@drama-sync/platform-meituan#build',
  '@drama-sync/platform-pinduoduo#build',
  '@drama-sync/platform-qq-short-drama#build',
  '@drama-sync/platform-tencent-video#build',
  '@drama-sync/platform-tiktok-drama#build',
  '@drama-sync/platform-weixin-channels#build',
]

export default defineConfig({
  check: {
    fmt: false,
  },
  fmt: {},
  run: {
    tasks: {
      'app-bundle': {
        command: 'vp build',
        dependsOn: ['prepare-icons', 'typecheck'],
        input: [
          'electron/**',
          'public/**',
          'src/**',
          'index.html',
          'package.json',
          'pnpm-lock.yaml',
          'tsconfig*.json',
          'vite.config.ts',
        ],
        output: ['dist/**', 'dist-electron/**'],
      },
      'app-dev': {
        cache: false,
        command: 'vp dev',
        dependsOn: [
          '@drama-sync/daren-center-automation#build',
          ...platformPackageBuildTasks,
          'prepare-platform-browser',
        ],
      },
      'app-package': {
        cache: false,
        command: 'electron-builder',
        dependsOn: [
          'app-bundle',
          'prepare-automation',
          'prepare-platform-browser',
        ],
      },
      'prepare-automation': {
        cache: false,
        command: 'node scripts/prepare-automation-resources.mjs',
      },
      'prepare-icons': {
        command: 'node scripts/generate-electron-icons.mjs',
        input: ['public/app-logo.svg', 'scripts/generate-electron-icons.mjs'],
        output: ['build/icons/**', 'public/app-logo.png'],
      },
      'prepare-platform-browser': {
        cache: false,
        command: 'node scripts/install-playwright-browser.mjs',
      },
      typecheck: {
        command: 'tsc --noEmit',
        dependsOn: [
          '@drama-sync/daren-center-automation#build',
          ...platformPackageBuildTasks,
        ],
        output: [],
      },
    },
  },
  lint: {
    categories: {
      correctness: 'error',
    },
    plugins: ['eslint', 'typescript', 'unicorn', 'oxc', 'react'],
    jsPlugins: [
      {
        name: 'vite-plus',
        specifier: 'vite-plus/oxlint-plugin',
      },
    ],
    ignorePatterns: ['dist/**', 'dist-electron/**'],
    rules: {
      'react/exhaustive-deps': 'warn',
      'react/only-export-components': 'off',
      'react/rules-of-hooks': 'error',
      'vite-plus/prefer-vite-plus-imports': 'error',
    },
    options: {
      maxWarnings: 0,
      typeAware: true,
      typeCheck: true,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [
    tailwindcss(),
    lazyPlugins(async () => {
      const [{ default: react }, { default: electron }] = await Promise.all([
        import('@vitejs/plugin-react'),
        import('vite-plugin-electron/simple'),
      ])

      return [
        react(),
        electron({
          main: {
            // Shortcut of `build.lib.entry`.
            entry: 'electron/main.ts',
            vite: {
              build: {
                emptyOutDir: true,
              },
              plugins: [
                notBundle({
                  filter: [
                    '@drama-sync/daren-center-automation',
                    /^@drama-sync\/platform-/,
                  ],
                }),
              ],
            },
          },
          preload: {
            // Shortcut of `build.rollupOptions.input`.
            // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
            input: path.join(__dirname, 'electron/preload.ts'),
          },
        }),
      ]
    }),
  ],
})
