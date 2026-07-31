import { definePlatform } from '@drama-sync/platform-automation-core'

export const meituanPlatform = definePlatform({
  authMode: 'sms-code',
  credentialFields: ['phone'],
  envPrefix: 'PLATFORM_MEITUAN',
  id: 'meituan',
  name: '美团',
})
