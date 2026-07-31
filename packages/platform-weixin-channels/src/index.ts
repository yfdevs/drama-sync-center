import { definePlatform } from '@drama-sync/platform-automation-core'

export const weixinChannelsPlatform = definePlatform({
  authMode: 'operator',
  envPrefix: 'PLATFORM_WEIXIN_CHANNELS',
  id: 'weixin-channels',
  name: '视频号',
})
