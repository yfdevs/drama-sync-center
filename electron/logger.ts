import log from 'electron-log/main'

const FIVE_MEGABYTES = 5 * 1024 * 1024

log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'info'
log.transports.file.level = 'info'
log.transports.file.fileName = 'drama-sync-center.log'
log.transports.file.maxSize = FIVE_MEGABYTES
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] [{scope}] {text}'

log.initialize()
log.errorHandler.startCatching({
  showDialog: false,
})

export const logger = log
