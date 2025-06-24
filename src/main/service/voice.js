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
  let isTempFile = false;
  
  // 如果是远程URL，先下载到临时目录
  if (filepath.startsWith('http') || filepath.startsWith('https')) {
    // 创建专用临时目录
    const tempDir = path.join(os.tmpdir(), 'voice-processing');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    try {
      const fileName = filepath.split('/').pop();
      const tmpPath = path.join(tempDir, fileName);
      log.debug('Downloading remote audio file', { 
        sourceUrl: filepath,
        tempPath: tmpPath 
      });
      
      // 重试机制
      const maxRetries = 3;
      let retryCount = 0;
      let downloadSuccess = false;
      
      while (retryCount < maxRetries && !downloadSuccess) {
        try {
          await remoteStorage.downloadFile(filepath, tmpPath);
          downloadSuccess = true;
          log.debug('Remote audio file downloaded successfully', {
            path: tmpPath,
            size: fs.statSync(tmpPath).size
          });
        } catch (error) {
          retryCount++;
          log.warn(`Download failed (attempt ${retryCount}/${maxRetries})`, error);
          if (retryCount >= maxRetries) {
            throw error;
          }
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
        }
      }
      
      audioPath = tmpPath;
      isTempFile = true;
    } catch (error) {
      log.error('Failed to download remote audio file after retries:', error);
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
    return insert({ origin_audio_path: filepath, lang, asr_format_audio_url, reference_audio_text })
  }
}

export async function makeAudio4Video({voiceId, text}) {
  log.debug('makeAudio4Video called', { voiceId, text });
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
  log.debug('copyAudio4Video called', { 
    filePath,
    remoteStorageEnabled: remoteStorageConfig.enabled
  });
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
      // 创建专用临时目录
      const tempDir = path.join(os.tmpdir(), 'voice-processing');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      const tmpFilePath = path.join(tempDir, fileName);
      
      // 写入临时文件
      try {
        fs.writeFileSync(tmpFilePath, audioBuffer, 'binary');
        log.debug('Audio file saved to temp location', { 
          path: tmpFilePath,
          size: audioBuffer.length 
        });
      } catch (error) {
        log.error('Failed to save audio to temp location:', error);
        throw new Error('Failed to save audio file');
      }

      // 上传到远程存储（带重试机制）
      const maxRetries = 3;
      let retryCount = 0;
      let uploadSuccess = false;
      
      while (retryCount < maxRetries && !uploadSuccess) {
        try {
          await remoteStorage.uploadFile(tmpFilePath, `audio/${fileName}`);
          uploadSuccess = true;
          log.info('Audio file uploaded to remote storage', { 
            remotePath: `audio/${fileName}`,
            size: audioBuffer.length 
          });
        } catch (error) {
          retryCount++;
          log.warn(`Upload failed (attempt ${retryCount}/${maxRetries})`, error);
          if (retryCount >= maxRetries) {
            log.error('Failed to upload audio after retries:', error);
            throw error;
          }
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
        }
      }
      
      // 清理临时文件
      try {
        if (fs.existsSync(tmpFilePath)) {
          fs.unlinkSync(tmpFilePath);
          log.debug('Removed temporary audio file', { path: tmpFilePath });
        }
      } catch (error) {
        log.error('Failed to remove temporary audio file:', error);
      }
      
      return fileName;
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
  log.debug('audition called', {
    voiceId,
    textPreview: text?.substring(0, 20) + (text?.length > 20 ? '...' : ''),
    storageType: remoteStorageConfig.enabled ? 'remote' : 'local'
  });
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
  const channel = MODEL_NAME + '/audition';
  ipcMain.handle(channel, (event, ...args) => {
    return audition(...args)
  });
  log.debug('IPC handler registered', { channel });
}