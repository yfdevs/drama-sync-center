import { definePlatform } from '@drama-sync/platform-automation-core'

export const pinduoduoPlatform = definePlatform({
  authMode: 'sms-code',
  credentialFields: ['phone'],
  envPrefix: 'PLATFORM_PINDUODUO',
  id: 'pinduoduo',
  name: '拼多多',
})
