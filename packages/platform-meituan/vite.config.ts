import { defineConfig } from 'vite-plus'

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: 'tsc',
        dependsOn: ['@drama-sync/platform-automation-core#build'],
        input: ['src/**/*.ts', 'package.json', 'tsconfig.json'],
        output: ['dist/**'],
      },
    },
  },
})
