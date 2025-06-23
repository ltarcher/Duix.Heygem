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

export async function train(path, lang = 'zh') {
  let audioPath = path;
  let isTempFile = false;
  
  // 如果是远程URL，先下载到临时目录
  if (path.startsWith('http') || path.startsWith('https')) {
    try {
      const fileName = path.split('/').pop();
      const tmpPath = path.join(os.tmpdir(), fileName);
      await remoteStorage.downloadFile(path, tmpPath);
      audioPath = tmpPath;
      isTempFile = true;
    } catch (error) {
      log.error('Failed to download remote audio file:', error);
      throw new Error('Failed to download remote audio file');
    }
  }

  audioPath = audioPath.replace(/\\/g, '/'); // 将路径中的\替换为/
  
  const res = await preprocessAndTran({
    format: audioPath.split('.').pop(),
    reference_audio: audioPath,
    lang
  });

  // 清理临时文件
  if (isTempFile && fs.existsSync(audioPath)) {
    fs.unlinkSync(audioPath);
  }
  log.debug('~ train ~ res:', res)
  if (res.code !== 0) {
    return false
  } else {
    const { asr_format_audio_url, reference_audio_text } = res
    return insert({ origin_audio_path: path, lang, asr_format_audio_url, reference_audio_text })
  }
}

export async function makeAudio4Video({voiceId, text}) {
  const fileName = await makeAudio({voiceId, text, targetDir: assetPath.ttsProduct});
  
  if (remoteStorageConfig.enabled) {
    // 如果启用了远程存储，需要将文件从audio目录复制到video目录
    try {
      // 创建临时文件路径
      const tmpFilePath = path.join(os.tmpdir(), fileName);
      
      // 从远程存储下载文件
      await remoteStorage.downloadFile(`audio/${fileName}`, tmpFilePath);
      
      // 上传到远程存储的视频目录
      await remoteStorage.uploadFile(tmpFilePath, `video/${fileName}`);
      
      // 删除临时文件
      fs.unlinkSync(tmpFilePath);
    } catch (error) {
      log.error('Error copying audio to video directory in remote storage:', error);
      throw error;
    }
  }
  
  return fileName;
}

export async function copyAudio4Video(filePath) {
  const fileName = dayjs().format('YYYYMMDDHHmmssSSS') + path.extname(filePath);
  
  if (remoteStorageConfig.enabled) {
    // 如果是远程存储
    try {
      // 检查filePath是否是本地文件路径
      if (fs.existsSync(filePath)) {
        // 如果是本地文件，直接上传到远程存储的视频目录
        await remoteStorage.uploadFile(filePath, `video/${fileName}`);
      } else {
        // 如果不是本地文件，假设它是一个远程存储的文件名
        // 创建临时文件路径
        const tmpFilePath = path.join(os.tmpdir(), path.basename(filePath));
        
        // 从远程存储下载文件
        await remoteStorage.downloadFile(`audio/${path.basename(filePath)}`, tmpFilePath);
        
        // 上传到远程存储的视频目录
        await remoteStorage.uploadFile(tmpFilePath, `video/${fileName}`);
        
        // 删除临时文件
        fs.unlinkSync(tmpFilePath);
      }
      return fileName;
    } catch (error) {
      log.error('Error copying audio to video directory in remote storage:', error);
      throw error;
    }
  } else {
    // 本地存储
    const targetDir = assetPath.ttsProduct;
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const targetPath = path.join(targetDir, fileName);
    fs.copyFileSync(filePath, targetPath);
    return fileName;
  }
}

export async function makeAudio({voiceId, text, targetDir}) {
  const uuid = crypto.randomUUID()
  const voice = selectByID(voiceId)

  try {
    const audioBuffer = await makeAudioApi({
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
    });

    const fileName = `${uuid}.wav`;

    if (remoteStorageConfig.enabled) {
      // 使用临时目录存储文件
      const tmpFilePath = path.join(os.tmpdir(), fileName);
      fs.writeFileSync(tmpFilePath, audioBuffer, 'binary');

      // 上传到远程存储
      try {
        await remoteStorage.uploadFile(tmpFilePath, `audio/${fileName}`);
        // 删除临时文件
        fs.unlinkSync(tmpFilePath);
        return fileName;
      } catch (error) {
        log.error('Error uploading to remote storage:', error);
        throw error;
      }
    } else {
      // 本地存储
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.writeFileSync(path.join(targetDir, fileName), audioBuffer, 'binary');
      return fileName;
    }
  } catch (error) {
    log.error('Error generating audio:', error);
    throw error;
  }
}

/**
 * 试听音频
 * @param {string} voiceId
 * @param {string} text
 * @returns
 */
export async function audition(voiceId, text) {
  if (remoteStorageConfig.enabled) {
    // 如果启用了远程存储，直接使用makeAudio生成并上传音频
    const fileName = await makeAudio({ voiceId, text, targetDir: os.tmpdir() });
    // 返回远程存储的URL
    return remoteStorage.getFileUrl(`audio/${fileName}`);
  } else {
    // 本地存储
    const tmpDir = os.tmpdir();
    console.log("🚀 ~ audition ~ tmpDir:", tmpDir);
    const audioPath = await makeAudio({ voiceId, text, targetDir: tmpDir });
    return path.join(tmpDir, audioPath);
  }
}

export function init() {
  ipcMain.handle(MODEL_NAME + '/audition', (event, ...args) => {
    return audition(...args)
  })
}