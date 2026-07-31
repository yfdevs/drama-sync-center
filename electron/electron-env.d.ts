/// <reference types="vite-plugin-electron/electron-env" />

import type { DesktopApi } from './shared'

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      /**
       * The built directory structure
       *
       * ```tree
       * ├─┬─┬ dist
       * │ │ └── index.html
       * │ │
       * │ ├─┬ dist-electron
       * │ │ ├── main.js
       * │ │ └── preload.js
       * │
       * ```
       */
      APP_ROOT: string
      /** /dist/ or /public/ */
      VITE_PUBLIC: string
    }
  }

  // Used in Renderer process, exposed in `preload.ts`.
  interface Window {
    desktop: DesktopApi
  }
}
