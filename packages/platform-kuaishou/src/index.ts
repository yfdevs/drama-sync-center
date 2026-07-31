import { definePlatform } from '@drama-sync/platform-automation-core'

export const kuaishouPlatform = definePlatform({
  authMode: 'qr-code',
  envPrefix: 'PLATFORM_KUAISHOU',
  id: 'kuaishou',
  name: '快手',
})
