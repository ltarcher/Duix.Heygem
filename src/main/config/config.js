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

export const assetPath = {
  model: isWin
    ? path.join('D:', 'heygem_data', 'face2face', 'temp')
    : path.join(os.homedir(), 'heygem_data', 'face2face', 'temp'), // 模特视频
  ttsProduct: isWin
    ? path.join('D:', 'heygem_data', 'face2face', 'temp')
    : path.join(os.homedir(), 'heygem_data', 'face2face', 'temp'), // TTS 产物
  ttsRoot: isWin
    ? path.join('D:', 'heygem_data', 'voice', 'data')
    : path.join(os.homedir(), 'heygem_data', 'voice', 'data'), // TTS服务根目录
  ttsTrain: isWin
    ? path.join('D:', 'heygem_data', 'voice', 'data', 'origin_audio')
    : path.join(os.homedir(), 'heygem_data', 'voice', 'data', 'origin_audio') // TTS 训练产物
}