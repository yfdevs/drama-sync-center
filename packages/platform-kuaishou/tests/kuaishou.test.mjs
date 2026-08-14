import assert from 'node:assert/strict'
import test from 'node:test'
import {
  downloadKuaishouMiniSeriesData,
  getKuaishouTeacherInfo,
  kuaishouMiniSeriesDownloadUrl,
  kuaishouTeacherInfoUrl,
} from '../dist/index.js'

void test('reads the logged-in Kuaishou teacher identity', async () => {
  const calls = []
  const page = {
    request: {
      get: async (url, options) => {
        calls.push({ options, url })
        return {
          json: async () => ({
            data: {
              bizIdentity: 3,
              headUrl: 'https://example.test/avatar.jpg',
              miniSeriesAccountType: 0,
              name: '红薯剧场',
              punished: false,
              userId: 5169595151,
            },
            error_msg: 'success',
            result: 1,
            successful: true,
          }),
          ok: () => true,
        }
      },
    },
  }

  const info = await getKuaishouTeacherInfo(page)
  assert.equal(info.name, '红薯剧场')
  assert.equal(info.userId, 5169595151)
  assert.equal(calls[0].url, kuaishouTeacherInfoUrl)
})

void test('downloads binary mini-series data with the selected date range', async () => {
  const calls = []
  const workbook = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01])
  const page = {
    request: {
      post: async (url, options) => {
        calls.push({ options, url })
        return {
          body: async () => workbook,
          headers: () => ({
            'content-disposition': 'attachment; filename="report.xlsx"',
            'content-type': 'application/octet-stream',
          }),
          ok: () => true,
        }
      },
    },
  }

  const result = await downloadKuaishouMiniSeriesData(page, {
    endDate: 1783612799000,
    startDate: 1783440000000,
  })

  assert.deepEqual(result.body, workbook)
  assert.equal(calls[0].url, kuaishouMiniSeriesDownloadUrl)
  assert.deepEqual(calls[0].options.data, {
    endDate: 1783612799000,
    miniSeriesIds: [],
    startDate: 1783440000000,
  })
})
