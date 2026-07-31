import { defineConfig } from 'vite-plus'

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: 'tsc',
        input: ['src/**/*.ts', 'package.json', 'tsconfig.json'],
        output: ['dist/**'],
      },
    },
  },
})
