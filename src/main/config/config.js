import path from 'path'
import os from 'os'

const isDev = process.env.NODE_ENV === 'development'
const isWin = process.platform === 'win32'

export const serviceUrl = {
  face2face: isDev 
    ? `http://${process.env.FACE2FACE_DEV_IP || '192.168.4.204'}:8383/easy`
    : `http://${process.env.FACE2FACE_PROD_IP || '127.0.0.1'}:8383/easy`,
  tts: isDev
    ? `http://${process.env.TTS_DEV_IP || '192.168.4.204'}:18180`
    : `http://${process.env.TTS_PROD_IP || '127.0.0.1'}:18180`
}

// 获取数据根目录，优先使用环境变量
const dataRoot = isWin
  ? process.env.HEYGEM_DATA_ROOT || 'D:'
  : process.env.HEYGEM_DATA_ROOT || os.homedir()

export const assetPath = {
  model: path.join(dataRoot, 'heygem_data', 'face2face', 'temp'), // 模特视频
  ttsProduct: path.join(dataRoot, 'heygem_data', 'face2face', 'temp'), // TTS 产物
  ttsRoot: path.join(dataRoot, 'heygem_data', 'voice', 'data'), // TTS服务根目录
  ttsTrain: path.join(dataRoot, 'heygem_data', 'voice', 'data', 'origin_audio') // TTS 训练产物
}