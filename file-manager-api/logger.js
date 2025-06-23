const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');

// 创建logs目录（如果不存在）
const logsDir = path.join(__dirname, 'logs');
if (!require('fs').existsSync(logsDir)) {
  require('fs').mkdirSync(logsDir);
}

// 定义日志格式
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message }) => {
    return `${timestamp} [${level.toUpperCase()}] ${message}`;
  })
);

// 创建日志转储传输
const fileRotateTransport = new winston.transports.DailyRotateFile({
  filename: path.join(logsDir, 'app-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxFiles: '14d',
  maxSize: '20m'
});

// 创建logger实例
const logger = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: [
    // 输出到控制台
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      )
    }),
    // 输出到日志文件
    fileRotateTransport
  ]
});

module.exports = logger;