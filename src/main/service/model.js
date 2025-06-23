import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
import dayjs from 'dayjs'
import { isEmpty } from 'lodash'
import { insert, selectPage, count, selectByID, remove as deleteModel } from '../dao/f2f-model.js'
import { train as trainVoice } from './voice.js'
import { assetPath, remoteStorageConfig } from '../config/config.js'
import { remoteStorage } from '../config/remoteStorage.js'
import log from '../logger.js'
import { extractAudio } from '../util/ffmpeg.js'
const MODEL_NAME = 'model'

/**
 * 新增模特
 * @param {string} modelName 模特名称
 * @param {string} videoPath 模特视频路径
 * @param {boolean} useRemoteStorage 是否使用远程存储
 * @returns
 */
function addModel(modelName, videoPath, useRemoteStorage = false) {
  // 生成文件名
  const extname = path.extname(videoPath)
  const modelFileName = dayjs().format('YYYYMMDDHHmmssSSS') + extname
  let modelPath = videoPath
  let audioPath = ''
  
  // 如果不是远程存储模式，则需要处理本地文件
  if (!(useRemoteStorage && remoteStorageConfig.enabled)) {
    // 确保本地目录存在
    try {
      if (!fs.existsSync(assetPath.model)) {
        fs.mkdirSync(assetPath.model, {
          recursive: true
        })
      }
      
      // 复制视频到模型目录
      modelPath = path.join(assetPath.model, modelFileName)
      fs.copyFileSync(videoPath, modelPath)
      
      // 确保音频目录存在
      if (!fs.existsSync(assetPath.ttsTrain)) {
        fs.mkdirSync(assetPath.ttsTrain, {
          recursive: true
        })
      }
    } catch (err) {
      log.error(`创建目录或复制文件失败: ${err.message}`, err)
      throw new Error(`存储初始化失败: ${err.message}`)
    }
  }
  
  // 设置音频路径
  audioPath = path.join(assetPath.ttsTrain, modelFileName.replace(extname, '.wav'))
  
  return extractAudio(modelPath, audioPath).then(async () => {
    // 如果启用了远程存储，上传文件到远程存储
    let remoteVideoPath = '';
    let remoteAudioPath = '';
    let isRemote = false;
    
    if (useRemoteStorage && remoteStorageConfig.enabled) {
      try {
        // 上传视频文件
        const videoKey = `${modelFileName}`;
        await remoteStorage.upload(videoKey, modelPath);
        remoteVideoPath = await remoteStorage.getUrl(videoKey);
        
        // 上传音频文件
        const audioKey = `${modelFileName.replace(extname, '.wav')}`;
        await remoteStorage.upload(audioKey, audioPath);
        remoteAudioPath = await remoteStorage.getUrl(audioKey);
        
        isRemote = true;
        log.info(`Model files uploaded to remote storage: ${videoKey}, ${audioKey}`);
      } catch (error) {
        log.error('Failed to upload model files to remote storage:', error);
        // 如果远程存储失败，回退到本地存储
        isRemote = false;
      }
    }
    
    // 训练语音模型
    const relativeAudioPath = isRemote ? remoteAudioPath : path.relative(assetPath.ttsRoot, audioPath);
    let voiceId;
    
    if (process.env.NODE_ENV === 'development') {
      // TODO 写死调试
      voiceId = await trainVoice('origin_audio/test.wav', 'zh');
    } else {
      voiceId = await trainVoice(relativeAudioPath, 'zh');
    }
    
    // 插入模特信息
    const videoPathToSave = isRemote ? remoteVideoPath : path.relative(assetPath.model, modelPath);
    const audioPathToSave = isRemote ? remoteAudioPath : path.relative(assetPath.ttsRoot, audioPath);
    
    // insert model info to db
    const id = insert({ 
      modelName, 
      videoPath: videoPathToSave, 
      audioPath: audioPathToSave, 
      voiceId,
      isRemote 
    });
    
    return id;
  });
}

function page({ page, pageSize, name = '' }) {
  const total = count(name)
  return {
    total,
    list: selectPage({ page, pageSize, name }).map((model) => {
      // 如果是远程存储的模型，直接返回原始路径
      if (model.isRemote) {
        return {
          ...model,
          video_path: model.video_path,
          audio_path: model.audio_path
        }
      }
      
      // 本地存储的模型，拼接完整路径
      return {
        ...model,
        video_path: path.join(assetPath.model, model.video_path),
        audio_path: path.join(assetPath.ttsRoot, model.audio_path)
      }
    })
  }
}

function findModel(modelId) {
  const model = selectByID(modelId)
  if (!model) return null
  
  // 如果是远程存储的模型，直接返回原始路径
  if (model.isRemote) {
    return {
      ...model,
      video_path: model.video_path,
      audio_path: model.audio_path
    }
  }
  
  // 本地存储的模型，拼接完整路径
  return {
    ...model,
    video_path: path.join(assetPath.model, model.video_path),
    audio_path: path.join(assetPath.ttsRoot, model.audio_path)
  }
}

async function removeModel(modelId) {
  const model = selectByID(modelId)
  if (!model) {
    log.warn(`Model not found with id: ${modelId}`)
    return
  }
  
  log.debug('~ removeModel ~ modelId:', modelId)

  try {
    if (model.isRemote) {
      // 删除远程存储的文件
      const videoKey = `${path.basename(model.video_path)}`
      const audioKey = `${path.basename(model.audio_path)}`
      
      try {
        await remoteStorage.delete(videoKey)
        await remoteStorage.delete(audioKey)
        log.info(`Deleted remote files: ${videoKey}, ${audioKey}`)
      } catch (error) {
        log.error('Failed to delete remote files:', error)
        // 即使远程文件删除失败，我们仍然继续删除数据库记录
      }
    } else {
      // 删除本地文件
      const videoPath = path.join(assetPath.model, model.video_path || '')
      if (!isEmpty(model.video_path) && fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath)
        log.info(`Deleted local video file: ${videoPath}`)
      }

      const audioPath = path.join(assetPath.ttsRoot, model.audio_path || '')
      if (!isEmpty(model.audio_path) && fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath)
        log.info(`Deleted local audio file: ${audioPath}`)
      }
    }

    // 删除数据库记录
    deleteModel(modelId)
    log.info(`Deleted model record from database: ${modelId}`)
  } catch (error) {
    log.error('Error removing model:', error)
    throw error
  }
}

function countModel(name = '') {
  return count(name)
}

export function init() {
  ipcMain.handle(MODEL_NAME + '/addModel', (event, ...args) => {
    return addModel(...args)
  })
  ipcMain.handle(MODEL_NAME + '/page', (event, ...args) => {
    return page(...args)
  })
  ipcMain.handle(MODEL_NAME + '/find', (event, ...args) => {
    return findModel(...args)
  })
  ipcMain.handle(MODEL_NAME + '/count', (event, ...args) => {
    return countModel(...args)
  })
  ipcMain.handle(MODEL_NAME + '/remove', (event, ...args) => {
    return removeModel(...args)
  })
}