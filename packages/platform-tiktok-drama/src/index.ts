import { definePlatform } from '@drama-sync/platform-automation-core'

export const tiktokDramaPlatform = definePlatform({
  authMode: 'account-password-with-email-verification',
  credentialFields: ['account', 'password'],
  envPrefix: 'PLATFORM_TIKTOK_DRAMA',
  id: 'tiktok-drama',
  name: 'TikTok Drama Center',
})
