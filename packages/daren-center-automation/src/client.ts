import type { DarenCenterConfig } from './config.js'

export interface ApiResponse<T> {
  clientType: string
  data: T | null
  message: string
  service: string
}

export interface LoginData {
  loginId: string
  loginType: string
  tokenName: string
  tokenValue: string
}

export interface ImportCopyrightDataOptions {
  file: Blob
  filename?: string
  sourceId: number | string
}

export interface DataSource {
  copyrightPartyId: number
  createdAt: string
  id: number
  name: string
  updatedAt: string
}

export interface DataSourcePage {
  page: number
  records: DataSource[]
  size: number
  total: number
}

export interface ListDataSourcesOptions {
  keyword?: string
  page?: number
  size?: number
}

export interface RequestResult<T> {
  body: ApiResponse<T>
  status: number
  statusText: string
}

type QueryValue = boolean | number | string | null | undefined

export interface DarenCenterRequestOptions<TBody = never> {
  authenticated?: boolean
  body?: TBody
  headers?: HeadersInit
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'
  query?: Record<string, QueryValue | QueryValue[]>
  signal?: AbortSignal
}

export interface DarenCenterClientOptions {
  fetch?: typeof fetch
}

export class DarenCenterApiError<T = unknown> extends Error {
  readonly response?: ApiResponse<T>
  readonly status: number
  readonly statusText: string

  constructor(result: RequestResult<T>) {
    super(result.body.message || `Daren Center API request failed (${result.status})`)
    this.name = 'DarenCenterApiError'
    this.response = result.body
    this.status = result.status
    this.statusText = result.statusText
  }
}

export class DarenCenterDataSourceNotFoundError extends Error {
  readonly sourceName: string

  constructor(sourceName: string) {
    super(`Daren Center data source not found: ${sourceName}`)
    this.name = 'DarenCenterDataSourceNotFoundError'
    this.sourceName = sourceName
  }
}

export class DarenCenterClient {
  readonly #config: DarenCenterConfig
  readonly #fetchImplementation: typeof fetch
  #loginPromise?: Promise<RequestResult<LoginData>>
  #tokenName = 'Authorization'
  #tokenValue?: string

  constructor(config: DarenCenterConfig, options: DarenCenterClientOptions = {}) {
    this.#config = config
    this.#fetchImplementation = options.fetch ?? globalThis.fetch
  }

  get authenticated(): boolean {
    return this.#tokenValue !== undefined
  }

  async login(): Promise<RequestResult<LoginData>> {
    this.#tokenValue = undefined
    return this.#authenticate()
  }

  async getCurrentUser<T = unknown>(): Promise<RequestResult<T>> {
    return this.request<T>('/api/b/auth/me')
  }

  async listDataSources(
    options: ListDataSourcesOptions = {},
  ): Promise<RequestResult<DataSourcePage>> {
    return this.request<DataSourcePage>('/api/b/data-sources', {
      query: {
        keyword: options.keyword,
        page: options.page ?? 1,
        size: options.size ?? 20,
      },
    })
  }

  async getSourceId(sourceName: string): Promise<number> {
    const normalizedSourceName = sourceName.trim()

    if (!normalizedSourceName) {
      throw new DarenCenterDataSourceNotFoundError(sourceName)
    }

    const pageSize = 100
    let page = 1

    while (true) {
      const result = await this.listDataSources({
        keyword: normalizedSourceName,
        page,
        size: pageSize,
      })
      const pageData = result.body.data
      const match = pageData?.records.find(
        (source) => source.name.trim() === normalizedSourceName,
      )

      if (match) {
        return match.id
      }

      if (
        !pageData ||
        pageData.records.length === 0 ||
        page * pageData.size >= pageData.total
      ) {
        throw new DarenCenterDataSourceNotFoundError(normalizedSourceName)
      }

      page += 1
    }
  }

  async importCopyrightData<T = unknown>(
    options: ImportCopyrightDataOptions,
  ): Promise<RequestResult<T>> {
    const formData = new FormData()
    const filename =
      options.filename ??
      ('name' in options.file && typeof options.file.name === 'string'
        ? options.file.name
        : 'copyright-data.xls')

    formData.append('files', options.file, filename)
    formData.append('sourceId', String(options.sourceId))

    return this.request<T, FormData>('/api/b/copyright-data/import', {
      body: formData,
      method: 'POST',
    })
  }

  /**
   * Common API entry point. It serializes JSON, injects the token, parses the
   * standard response envelope and refreshes authentication once after a 401.
   * FormData bodies are forwarded untouched so fetch can generate the multipart
   * boundary.
   */
  async request<TResponse, TBody = never>(
    path: string,
    options: DarenCenterRequestOptions<TBody> = {},
  ): Promise<RequestResult<TResponse>> {
    return this.#request(path, options, true)
  }

  clearToken(): void {
    this.#tokenValue = undefined
  }

  async #request<TResponse, TBody>(
    path: string,
    options: DarenCenterRequestOptions<TBody>,
    retryUnauthorized: boolean,
  ): Promise<RequestResult<TResponse>> {
    const authenticated = options.authenticated ?? true
    let requestToken: string | undefined

    if (authenticated) {
      requestToken = await this.#getToken()
    }

    const result = await this.#fetch<TResponse, TBody>(path, options, requestToken)

    if (result.status === 401 && authenticated && retryUnauthorized) {
      // Another concurrent request may already have refreshed the token.
      if (this.#tokenValue === requestToken) {
        this.#tokenValue = undefined
      }

      await this.#getToken()
      return this.#request(path, options, false)
    }

    if (!isSuccessful(result.status)) {
      throw new DarenCenterApiError(result)
    }

    return result
  }

  async #authenticate(): Promise<RequestResult<LoginData>> {
    if (this.#loginPromise) {
      return this.#loginPromise
    }

    this.#loginPromise = this.#performLogin()

    try {
      return await this.#loginPromise
    } finally {
      this.#loginPromise = undefined
    }
  }

  async #performLogin(): Promise<RequestResult<LoginData>> {
    const result = await this.#fetch<LoginData, { password: string; username: string }>(
      '/api/b/auth/login',
      {
        authenticated: false,
        body: {
          password: this.#config.password,
          username: this.#config.username,
        },
        method: 'POST',
      },
      undefined,
    )

    if (!isSuccessful(result.status)) {
      throw new DarenCenterApiError(result)
    }

    const loginData = result.body.data

    if (!loginData?.tokenValue) {
      throw new DarenCenterApiError({
        ...result,
        body: {
          ...result.body,
          message: result.body.message || 'Login response does not contain a token',
        },
      })
    }

    this.#tokenName = loginData.tokenName || 'Authorization'
    this.#tokenValue = loginData.tokenValue

    return result
  }

  async #fetch<TResponse, TBody>(
    path: string,
    options: DarenCenterRequestOptions<TBody>,
    tokenValue: string | undefined,
  ): Promise<RequestResult<TResponse>> {
    const headers = new Headers(options.headers)
    headers.set('accept', 'application/json, text/plain, */*')
    headers.set('accept-language', 'zh-CN,zh;q=0.9,en;q=0.8')
    headers.set('cache-control', 'no-cache')
    headers.set('pragma', 'no-cache')

    const requestBody = serializeRequestBody(options.body)

    if (
      requestBody !== undefined &&
      !(requestBody instanceof FormData) &&
      !headers.has('content-type')
    ) {
      headers.set('content-type', 'application/json;charset=UTF-8')
    }

    if (tokenValue) {
      headers.set(this.#tokenName, tokenValue)
    }

    const response = await this.#fetchImplementation(this.#createUrl(path, options.query), {
      body: requestBody,
      headers,
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      signal: options.signal ?? AbortSignal.timeout(this.#config.timeoutMs),
    })
    const body = await parseResponse<TResponse>(response)

    return {
      body,
      status: response.status,
      statusText: response.statusText,
    }
  }

  #createUrl(
    path: string,
    query: DarenCenterRequestOptions<unknown>['query'],
  ): URL {
    const url = new URL(path, `${this.#config.baseUrl}/`)

    for (const [name, rawValue] of Object.entries(query ?? {})) {
      const values = Array.isArray(rawValue) ? rawValue : [rawValue]

      for (const value of values) {
        if (value !== undefined && value !== null) {
          url.searchParams.append(name, String(value))
        }
      }
    }

    return url
  }

  async #getToken(): Promise<string> {
    if (this.#tokenValue) {
      return this.#tokenValue
    }

    const result = await this.#authenticate()
    return result.body.data!.tokenValue
  }
}

function isSuccessful(status: number): boolean {
  return status >= 200 && status < 300
}

function serializeRequestBody<T>(body: T | undefined): BodyInit | undefined {
  if (body === undefined) {
    return undefined
  }

  if (body instanceof FormData) {
    return body
  }

  return JSON.stringify(body)
}

async function parseResponse<T>(response: Response): Promise<ApiResponse<T>> {
  const text = await response.text()

  if (!text) {
    return {
      clientType: '',
      data: null,
      message: response.statusText,
      service: '',
    }
  }

  try {
    return JSON.parse(text) as ApiResponse<T>
  } catch {
    return {
      clientType: '',
      data: null,
      message: text,
      service: '',
    }
  }
}
