import path from 'path'
import os from 'os'

const isDev = process.env.NODE_ENV === 'development'
const isWin = process.platform === 'win32'

// 远程存储配置 (支持Minio/S3)
// 远程存储配置 (支持Minio/S3/API)
export const remoteStorageConfig = {
  enabled: process.env.REMOTE_STORAGE_ENABLED === 'false' || false, // 从环境变量获取
  type: process.env.REMOTE_STORAGE_TYPE || 'api',  // 存储类型 (minio/api)
  endpoint: process.env.REMOTE_STORAGE_ENDPOINT || 'http://localhost:9000', // minio服务地址
  apiEndpoint: process.env.REMOTE_STORAGE_API_ENDPOINT || 'http://localhost:3000', // API服务地址
  region: process.env.REMOTE_STORAGE_REGION || 'us-east-1', // 存储区域
  bucket: process.env.REMOTE_STORAGE_BUCKET || 'heygemdata', // 存储桶
  accessKey: process.env.REMOTE_STORAGE_ACCESS_KEY || 'myminio', // 访问密钥
  secretKey: process.env.REMOTE_STORAGE_SECRET_KEY || 'myminio' // 秘密密钥
}

export const serviceUrl = {
  face2face: isDev 
    ? `http://${process.env.FACE2FACE_DEV_IP || '200.200.167.104'}:8383/easy`
    : `http://${process.env.FACE2FACE_PROD_IP || '127.0.0.1'}:8383/easy`,
  tts: isDev
    ? `http://${process.env.TTS_DEV_IP || '200.200.167.104'}:18180`
    : `http://${process.env.TTS_PROD_IP || '127.0.0.1'}:18180`
}

// 获取数据根目录，优先使用环境变量
const dataRoot = remoteStorageConfig.enabled ? process.cwd(): isWin
  ? process.env.HEYGEM_DATA_ROOT || 'D:'
  : process.env.HEYGEM_DATA_ROOT || os.homedir()

export const assetPath = {
  dataRoot: dataRoot, // 数据根目录
  model: path.join(dataRoot, 'heygem_data', 'face2face', 'temp'), // 模特视频
  ttsProduct: path.join(dataRoot, 'heygem_data', 'face2face', 'temp'), // TTS 产物
  ttsRoot: path.join(dataRoot, 'heygem_data', 'voice', 'data'), // TTS服务根目录
  ttsTrain: path.join(dataRoot, 'heygem_data', 'voice', 'data', 'origin_audio') // TTS 训练产物
}