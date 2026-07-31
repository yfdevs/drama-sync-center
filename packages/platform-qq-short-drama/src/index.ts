import { definePlatform } from '@drama-sync/platform-automation-core'

export const qqShortDramaPlatform = definePlatform({
  authMode: 'sms-code',
  envPrefix: 'PLATFORM_QQ_SHORT_DRAMA',
  id: 'qq-short-drama',
  name: 'QQ漫剧',
})
