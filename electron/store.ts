import Store from 'electron-store'

type StoreValue = unknown
type StoreData = Record<string, StoreValue>

const KEY_PART_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const store = new Store<StoreData>({
  name: 'settings',
})

function assertKeyPart(value: string, label: string): string {
  const normalized = value.trim().toLowerCase()

  if (!KEY_PART_PATTERN.test(normalized)) {
    throw new Error(
      `${label} must use lowercase kebab-case (letters, numbers and single hyphens only)`,
    )
  }

  return normalized
}

/**
 * Store key convention:
 * - global:<key>                         shared application setting
 * - platform:<platformId>:<key>          setting owned by one sync platform
 *
 * Examples: global:language, platform:bangumi:auto-sync
 */
export function globalStoreKey(key: string): string {
  return `global:${assertKeyPart(key, 'Store key')}`
}

export function platformStoreKey(platformId: string, key: string): string {
  return `platform:${assertKeyPart(platformId, 'Platform ID')}:${assertKeyPart(key, 'Store key')}`
}

export const storeService = {
  get(key: string): StoreValue {
    return store.get(globalStoreKey(key))
  },

  set(key: string, value: StoreValue): void {
    store.set(globalStoreKey(key), value)
  },

  delete(key: string): void {
    store.delete(globalStoreKey(key))
  },

  getForPlatform(platformId: string, key: string): StoreValue {
    return store.get(platformStoreKey(platformId, key))
  },

  setForPlatform(platformId: string, key: string, value: StoreValue): void {
    store.set(platformStoreKey(platformId, key), value)
  },

  deleteForPlatform(platformId: string, key: string): void {
    store.delete(platformStoreKey(platformId, key))
  },
}
