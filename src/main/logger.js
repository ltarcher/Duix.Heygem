const log = require('electron-log')
const path = require('path')
const fs = require('fs')

// 统一配置
const isDev = process.env.NODE_ENV === 'development'

// 开发环境显示 debug，生产环境只显示 info 以上
const defaultLevel = isDev ? 'debug' : 'info'

// 设置日志目录
const logDir = path.join(process.env.APPDATA || 
  (process.platform === 'darwin' ? 
    path.join(process.env.HOME, 'Library/Logs') : 
    path.join(process.env.HOME, '.config')
  ), 
  'Duix.Heygem/logs')

// 确保日志目录存在
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true })
}

// 设置日志文件路径
log.transports.file.resolvePath = () => path.join(logDir, 'main.log')

// 统一配置日志级别
Object.keys(log.transports).forEach((transport) => {
  if (log.transports[transport].level) {
    log.transports[transport].level = defaultLevel
  }
})

// 可选：自定义日志格式
log.transports.file.format = '{y}-{m}-{d} {h}:{i}:{s} [{level}] {text}'
log.transports.console.format = '[{level}] {text}'

// 设置日志文件大小上限（字节）
log.transports.file.maxSize = 2 * 1024 * 1024 // 2M

// 设置日志文件备份数量
log.transports.file.maxFiles = 5

// 导出配置好的日志实例
export default log