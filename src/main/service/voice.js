import { selectAll, insert, selectByID } from '../dao/voice.js'
import { preprocessAndTran, makeAudio as makeAudioApi } from '../api/tts.js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { assetPath, remoteStorageConfig } from '../config/config.js'
import log from '../logger.js'
import { ipcMain } from 'electron'
import dayjs from 'dayjs'
import { remoteStorage } from '../config/remoteStorage.js'
import os from 'os'

const MODEL_NAME = 'voice'

export function getAllTimbre() {
  log.debug('getAllTimbre called');
  return selectAll()
}

export async function train(filepath, lang = 'zh') {
  let audioPath = filepath;

  audioPath = audioPath.replace(/\\/g, '/'); // 将路径中的\替换为/
  log.debug('~ train ~ audioPath:', audioPath)
  
  //调用API训练学习模特语音
  const res = await preprocessAndTran({
    format: audioPath.split('.').pop(),
    reference_audio: audioPath,
    lang
  });

  log.debug('~ train ~ res:', res)
  if (res.code !== 0) {
    return false
  } else {
    const { asr_format_audio_url, reference_audio_text } = res
    // 如果是远程存储，那么把训练后的音频下载到本地存储
    if (remoteStorageConfig.enabled) {
      // 如果是远程存储，那么把训练后的音频下载到本地存储
      try {
        let format_audio = path.join(assetPath.ttsTrain, `format_${path.basename(audioPath)}`)
        let format_denoise = path.join(assetPath.ttsTrain, `format_denoise_${path.basename(audioPath)}`)
        format_audio = path.relative(assetPath.dataRoot, format_audio)
        format_denoise = path.relative(assetPath.dataRoot, format_denoise)

        await remoteStorage.download(format_audio, format_audio);
        await remoteStorage.download(format_denoise, format_denoise);

        log.debug('~ train ~ localformatPath:', format_audio)
        log.debug('~ train ~ localdenoisePath:', format_denoise)

      } catch (error) {
        log.error('Error downloading audio from remote storage:', error);
        throw error;
      }
    }
        

    return insert({ origin_audio_path: audioPath, lang, asr_format_audio_url, reference_audio_text })
  }
}

export async function makeAudio4Video({voiceId, text}) {
  log.debug('makeAudio4Video called', { voiceId, text });
  const fileName = await makeAudio({voiceId, text, targetDir: assetPath.ttsProduct});
  log.debug('~ makeAudio4Video ~ fileName:', fileName)  
  return fileName;
}

export function copyAudio4Video(filePath) {
  // 将filePath复制到ttsProduct目录下
  const targetDir = assetPath.ttsProduct
  const fileName = dayjs().format('YYYYMMDDHHmmssSSS') + path.extname(filePath)
  const targetPath = path.join(targetDir, fileName)
  fs.copyFileSync(filePath, targetPath)
  return fileName
}

export async function makeAudio({voiceId, text, targetDir}) {
  const uuid = crypto.randomUUID()
  const voice = selectByID(voiceId)

  return makeAudioApi({
    speaker: uuid,
    text,
    format: 'wav',
    topP: 0.7,
    max_new_tokens: 1024,
    chunk_length: 100,
    repetition_penalty: 1.2,
    temperature: 0.7,
    need_asr: false,
    streaming: false,
    is_fixed_seed: 0,
    is_norm: 1,
    reference_audio: voice.asr_format_audio_url,
    reference_text: voice.reference_audio_text
  })
    .then((res) => {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, {
          recursive: true
        })
      }
      let filename = path.join(targetDir, `${uuid}.wav`)
      fs.writeFileSync(filename, res, 'binary')
      return filename
    })
    .catch((error) => {
      log.error('Error generating audio:', error)
      throw error
    })
}

/**
 * 试听音频
 * @param {string} voiceId
 * @param {string} text
 * @returns
 */
export async function audition(voiceId, text) {
  const tmpDir = require('os').tmpdir()
  console.log("🚀 ~ audition ~ tmpDir:", tmpDir)
  const audioPath = await makeAudio({ voiceId, text, targetDir: tmpDir })
  return path.join(tmpDir, audioPath)
}

export function init() {
  const channel = MODEL_NAME + '/audition';
  ipcMain.handle(channel, (event, ...args) => {
    return audition(...args)
  });
  log.debug('IPC handler registered', { channel });
}