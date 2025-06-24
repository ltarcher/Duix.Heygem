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
import { extractAudio, toH264 } from '../util/ffmpeg.js'
import { viewDepthKey } from 'vue-router'
const MODEL_NAME = 'model'

/**
 * 新增模特
 * @param {string} modelName 模特名称
 * @param {string} videoPath 模特视频路径
 * @returns
 */
async function addModel(modelName, videoPath) {
  log.debug('addModel called', { modelName, videoPath, remoteStorageEnabled: remoteStorageConfig.enabled });
  
  // 1. 准备文件名和路径
  const extname = path.extname(videoPath);
  const modelFileName = dayjs().format('YYYYMMDDHHmmssSSS') + extname;

  // 确保本地目录存在
  try {
        if (!fs.existsSync(assetPath.model)) {
          fs.mkdirSync(assetPath.model, { recursive: true });
        }
        if (!fs.existsSync(assetPath.ttsTrain)) {
          fs.mkdirSync(assetPath.ttsTrain, { recursive: true });
        }
  } catch (err) {
        log.error(`创建目录失败: ${err.message}`, err);
        throw new Error(`存储初始化失败: ${err.message}`);
  }

  // 复制文件到最终位置
  const finalVideoPath = path.join(assetPath.model, modelFileName);
  const finalAudioPath = path.join(assetPath.ttsTrain, modelFileName.replace(extname, '.wav'));

  log.debug('Copying model files to local storage :', { finalVideoPath, finalAudioPath })
      
  try {

    // 3. 转换视频到临时目录并提取音频（本地最后要有Nvidia显卡）
    //fs.copyFileSync(videoPath, tempVideoPath);
    await toH264(videoPath, finalVideoPath)

    // 提取音频
    await extractAudio(finalVideoPath, finalAudioPath);

    // 4. 远程存储处理，把模特视频和音频都上传
    if (remoteStorageConfig.enabled) {
      try {
        // 统一远程路径前缀
        const remotePrefix = ``;
        let videoKey = `${assetPath.model}/${remotePrefix}${modelFileName}`;
        let audioKey = `${assetPath.ttsTrain}/${remotePrefix}${modelFileName.replace(extname, '.wav')}`;

        // 取相对路径
        videoKey = path.relative(assetPath.dataRoot, videoKey);
        audioKey = path.relative(assetPath.dataRoot, audioKey);

        log.debug('Uploading model files to remote storage', {
          videoKey,
          audioKey
        });

        // 并行上传文件
        await Promise.all([
          remoteStorage.upload(videoKey, finalVideoPath),
          remoteStorage.upload(audioKey, finalAudioPath)
        ]);

        log.info(`Model files uploaded to remote storage: ${videoKey}, ${audioKey}`);

      } catch (error) {
        log.error('Failed to upload model files to remote storage:', error);
        throw new Error('Remote storage operation failed');
      }
    }

    // 6. 训练语音模型
    const relativeAudioPath = path.relative(assetPath.ttsRoot, 
      path.join(assetPath.ttsTrain, modelFileName.replace(extname, '.wav')));

    let voiceId;
    // 远程调用API进行
    voiceId = await trainVoice(relativeAudioPath, 'zh');

    // 7. 保存到数据库，都是相对路径
    const videoPathToSave = path.relative(assetPath.model, finalVideoPath);
    const audioPathToSave = path.relative(assetPath.ttsTrain, finalAudioPath);

    const id = insert({ 
      modelName, 
      videoPath: videoPathToSave, 
      audioPath: audioPathToSave, 
      voiceId 
    });

    return id;
  } catch (error) {
    log.debug('Cleaning up local files', { finalVideoPath, finalAudioPath })
  }
}

function page({ page, pageSize, name = '' }) {
  log.debug('page called', { page, pageSize, name });
  const total = count(name)
  return {
    total,
    list: selectPage({ page, pageSize, name }).map((model) => ({
      ...model,
      video_path: path.join(assetPath.model, model.video_path),
      audio_path: path.join(assetPath.ttsRoot, model.audio_path)
    }))
  }
}

function findModel(modelId) {
  log.debug('findModel called', { modelId });
  const model = selectByID(modelId)
  if (!model) return null
  
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
    if (remoteStorageConfig.enabled) {
      // 删除远程存储的文件
      let videoKey = `${assetPath.model}/${path.basename(model.video_path)}`;
      let audioKey = `${assetPath.ttsTrain}/${path.basename(model.audio_path)}`;
      let audio_format = `${assetPath.ttsTrain}/format_${path.basename(model.audio_path)}`
      let audio_format_deniose = `${assetPath.ttsTrain}/format_deniose_${path.basename(model.audio_path)}`
      
      log.debug('Deleting remote model files', { videoKey, audioKey, audio_format, audio_format_deniose });

      // 转化为远程相对路径
      videoKey = path.relative(assetPath.dataRoot, videoKey);
      audioKey = path.relative(assetPath.dataRoot, audioKey);
      audio_format = path.relative(assetPath.dataRoot, audio_format);
      audio_format_deniose = path.relative(assetPath.dataRoot, audio_format_deniose);

      log.debug('Deleting remote model files', { videoKey, audioKey, audio_format, audio_format_deniose })
      
      // 重试机制
      const maxRetries = 3;
      let retryCount = 0;
      
      const deleteWithRetry = async (key) => {
        while (retryCount < maxRetries) {
          try {
            await remoteStorage.delete(key);
            log.info(`Successfully deleted remote file: ${key}`);
            return true;
          } catch (error) {
            retryCount++;
            log.warn(`Failed to delete remote file (attempt ${retryCount}/${maxRetries}): ${key}`, error);
            if (retryCount >= maxRetries) {
              log.error(`Failed to delete remote file after ${maxRetries} attempts: ${key}`, error);
              return false;
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // 指数退避
          }
        }
      };
      
      try {
        const videoDeleted = await deleteWithRetry(videoKey);
        const audioDeleted = await deleteWithRetry(audioKey);
        const audioformatDeleted = await deleteWithRetry(audio_format);
        const audioformatdenioseDeleted = await deleteWithRetry(audio_format_deniose);
        
        if (!videoDeleted || !audioDeleted || audioformatDeleted || audioformatdenioseDeleted) {
          log.error('Some remote files could not be deleted', {
            videoDeleted,
            audioDeleted,
            audioformatDeleted,
            audioformatdenioseDeleted
          });
        }
      } catch (error) {
        log.error('Failed to delete remote files:', error);
      }
    } else {
      // 删除本地文件
      const deleteLocalFile = (filePath) => {
        if (!isEmpty(filePath) && fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
            log.info(`Deleted local file: ${filePath}`);
          } catch (error) {
            log.error(`Failed to delete local file: ${filePath}`, error);
          }
        } else {
          log.debug(`Local file not found or empty path: ${filePath}`);
        }
      };
      
      const videoPath = path.join(assetPath.model, model.video_path || '');
      const audioPath = path.join(assetPath.ttsRoot, model.audio_path || '');
      
      deleteLocalFile(videoPath);
      deleteLocalFile(audioPath);
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
  log.debug('countModel called', { name });
  return count(name)
}

export function init() {
  ipcMain.handle(MODEL_NAME + '/addModel', async (event, ...args) => {
    return await addModel(...args)
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