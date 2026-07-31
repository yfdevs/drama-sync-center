import { definePlatform } from '@drama-sync/platform-automation-core'

export const tencentVideoPlatform = definePlatform({
  authMode: 'qq-qr-code',
  envPrefix: 'PLATFORM_TENCENT_VIDEO',
  id: 'tencent-video',
  name: '腾讯（火龙）视频',
})
