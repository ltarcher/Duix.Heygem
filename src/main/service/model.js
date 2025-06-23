import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
import dayjs from 'dayjs'
import { isEmpty } from 'lodash'
import { insert, selectPage, count, selectByID, remove as deleteModel } from '../dao/f2f-model.js'
import { train as trainVoice } from './voice.js'
import { assetPath, remoteStorageConfig } from '../config/config.js'
import { remoteStorage } from '../util/remoteStorage.js'
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
  // 确保本地目录存在
  if (!fs.existsSync(assetPath.model)) {
    fs.mkdirSync(assetPath.model, {
      recursive: true
    })
  }
  
  // 生成文件名
  const extname = path.extname(videoPath)
  const modelFileName = dayjs().format('YYYYMMDDHHmmssSSS') + extname
  const modelPath = path.join(assetPath.model, modelFileName)
  
  // 复制视频到模型目录
  fs.copyFileSync(videoPath, modelPath)
  
  // 用ffmpeg分离音频
  if (!fs.existsSync(assetPath.ttsTrain)) {
    fs.mkdirSync(assetPath.ttsTrain, {
      recursive: true
    })
  }
  const audioPath = path.join(assetPath.ttsTrain, modelFileName.replace(extname, '.wav'))
  
  return extractAudio(modelPath, audioPath).then(async () => {
    // 如果启用了远程存储，上传文件到远程存储
    let remoteVideoPath = '';
    let remoteAudioPath = '';
    let isRemote = false;
    
    if (useRemoteStorage && remoteStorageConfig.enabled) {
      try {
        // 上传视频文件
        const videoKey = `models/videos/${modelFileName}`;
        await remoteStorage.upload(videoKey, modelPath);
        remoteVideoPath = await remoteStorage.getUrl(videoKey);
        
        // 上传音频文件
        const audioKey = `models/audios/${modelFileName.replace(extname, '.wav')}`;
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

function removeModel(modelId) {
  const model = selectByID(modelId)
  log.debug('~ removeModel ~ modelId:', modelId)

  // 如果不是远程存储的模型，则删除本地文件
  if (!model.isRemote) {
    // 删除视频
    const videoPath = path.join(assetPath.model, model.video_path || '')
    if (!isEmpty(model.video_path) && fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath)
    }

    // 删除音频
    const audioPath = path.join(assetPath.ttsRoot, model.audio_path || '')
    if (!isEmpty(model.audio_path) && fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath)
    }
  }

  deleteModel(modelId)
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