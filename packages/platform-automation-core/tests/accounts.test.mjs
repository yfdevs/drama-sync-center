import assert from 'node:assert/strict'
import test from 'node:test'
import {
  definePlatform,
  listPlatformAccountIds,
  loadPlatformRuntimeConfig,
} from '../dist/index.js'

const platform = definePlatform({
  authMode: 'sms-code',
  credentialFields: ['phone'],
  envPrefix: 'PLATFORM_TEST',
  id: 'test',
  name: '测试平台',
})

const environment = {
  PLATFORM_BROWSER_PROFILE_ROOT: 'platform-browser-profiles',
  PLATFORM_TEST_ACCOUNT_IDS: 'main, secondary',
  PLATFORM_TEST_ACCOUNT_MAIN_LABEL: '主账号',
  PLATFORM_TEST_ACCOUNT_MAIN_PHONE: '13000000000',
  PLATFORM_TEST_ACCOUNT_SECONDARY_LABEL: '副账号',
  PLATFORM_TEST_ACCOUNT_SECONDARY_PHONE: '13100000000',
  PLATFORM_TEST_LOGIN_NOTE: '验证码登录',
  PLATFORM_TEST_URL: 'https://example.test/data',
}

void test('loads independent credentials for multiple platform accounts', () => {
  assert.deepEqual(listPlatformAccountIds(platform, environment), [
    'main',
    'secondary',
  ])

  const main = loadPlatformRuntimeConfig(platform, 'main', environment)
  const secondary = loadPlatformRuntimeConfig(
    platform,
    'secondary',
    environment,
  )

  assert.equal(main.account.label, '主账号')
  assert.equal(main.account.credentials.phone, '13000000000')
  assert.equal(secondary.account.label, '副账号')
  assert.equal(secondary.account.credentials.phone, '13100000000')
})

void test('rejects an account that is not configured for the platform', () => {
  assert.throws(
    () => loadPlatformRuntimeConfig(platform, 'unknown', environment),
    /Unknown account "unknown"/,
  )
})
