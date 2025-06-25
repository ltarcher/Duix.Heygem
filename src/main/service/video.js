import { ipcMain } from 'electron'
import crypto from 'crypto'
import path from 'path'
import fs from 'fs'
import { isEmpty } from 'lodash'
import { assetPath, remoteStorageConfig } from '../config/config.js'
import { remoteStorage } from '../config/remoteStorage.js'
import { selectPage,selectByStatus, updateStatus, remove as deleteVideo, findFirstByStatus } from '../dao/video.js'
import { selectByID as selectF2FModelByID } from '../dao/f2f-model.js'
import { selectByID as selectVoiceByID } from '../dao/voice.js'
import {
  insert as insertVideo,
  count,
  update,
  selectByID as selectVideoByID
} from '../dao/video.js'
import { makeAudio4Video, copyAudio4Video } from './voice.js'
import { makeVideo as makeVideoApi,getVideoStatus } from '../api/f2f.js'
import log from '../logger.js'
import { getVideoDuration } from '../util/ffmpeg.js'

const MODEL_NAME = 'video'

/**
 * 分页查询合成结果
 * @param {number} page
 * @param {number} pageSize
 * @returns
 */
function page({ page, pageSize, name = '' }) {
  // 查询的有waiting状态的视频
  const waitingVideos = selectByStatus('waiting').map((v) => v.id)
  const total = count(name)
  const list = selectPage({ page, pageSize, name }).map((video) => {
    video = {
      ...video,
      file_path: video.file_path 
        ? (remoteStorageConfig.enabled 
           ? video.file_path 
           : path.join(assetPath.model, video.file_path))
        : video.file_path
    }

    if(video.status === 'waiting'){
      video.progress = `${waitingVideos.indexOf(video.id) + 1} / ${waitingVideos.length}`
    }
    return video
  })

  return {
    total,
    list
  }
}

function findVideo(videoId) {
  const video = selectVideoByID(videoId)
  return {
    ...video,
    file_path: video.file_path 
      ? (remoteStorageConfig.enabled 
         ? video.file_path 
         : path.join(assetPath.model, video.file_path))
      : video.file_path
  }
}

function countVideo(name = '') {
  return count(name)
}

function saveVideo({ id, model_id, name, text_content, voice_id, audio_path }) {
  const video = selectVideoByID(id)
  if(audio_path){
    audio_path = copyAudio4Video(audio_path)
  }

  if (video) {
    return update({ id, model_id, name, text_content, voice_id, audio_path })
  }
  return insertVideo({ model_id, name, status: 'draft', text_content, voice_id, audio_path })
}

/**
 * 合成视频
 * 更新视频状态为waiting
 * @param {number} videoId
 * @returns
 */
function makeVideo(videoId) {
  update({ id: videoId, status: 'waiting' })
  return videoId
}

export async function synthesisVideo(videoId) {
  try {
    log.debug('Starting video synthesis', { videoId });
    update({
      id: videoId,
      file_path: null,
      status: 'pending',
      message: '正在提交任务',
    })

    // 查询Video
    const video = selectVideoByID(videoId)
    log.debug('Video details fetched', { 
      videoId,
      modelId: video.model_id,
      voiceId: video.voice_id,
      textLength: video.text_content?.length 
    })

    // 根据modelId获取model信息
    const model = selectF2FModelByID(video.model_id)
    log.debug('Model details fetched', {
      modelId: model.id,
      videoPath: model.video_path
    })

    let audioPath
    if(video.audio_path){
      log.debug('Using existing audio file', {audioPath: video.audio_path})
      audioPath = video.audio_path
    }else{
      // 根据model信息中的voiceId获取voice信息
      const voice = selectVoiceByID(video.voice_id || model.voice_id)
      log.debug('Selected voice model', {
        voiceId: voice.id,
        voiceName: voice.name
      })

      // 调用tts接口生成音频
      log.info('Generating audio from text', {
        textPreview: video.text_content?.substring(0, 50) + (video.text_content?.length > 50 ? '...' : '')
      })
      audioPath = await makeAudio4Video({
        voiceId: voice.id,
        text: video.text_content
      })
      let audiofullpath;
      if (remoteStorageConfig.enabled) {
        audiofullpath = path.join(assetPath.ttsProduct, audioPath)
      }
      log.info('Audio generated successfully', {
        audioPath,
        fileSize: fs.existsSync(audiofullpath) ? `${(fs.statSync(audiofullpath).size / 1024).toFixed(2)}KB` : 'unknown'
      })
    }

    // 调用视频生成接口生成视频
    let result, param
    ({ result, param } = await makeVideoByF2F(audioPath, model.video_path))

    log.debug('~ makeVideo ~ result, param:', result, param)

    // 插入视频表
    if(10000 === result.code){ // 成功
      update({
        id: videoId,
        file_path: null,
        status: 'pending',
        message: result,
        audio_path: audioPath,
        param,
        code: param.code
      })
    }else{ // 失败
      update({
        id: videoId,
        file_path: null,
        status: 'failed',
        message: result.msg,
        audio_path: audioPath,
        param,
        code: param.code
      })
    }
  } catch (error) {
    log.error('~ synthesisVideo ~ error:', error.message)
    updateStatus(videoId, 'failed', error.message)
  }

  // 6. 返回视频id
  return videoId
}

export async function loopPending() {
  log.debug('Starting pending video tasks check')
  const video = findFirstByStatus('pending')
  if (!video) {
    log.debug('No pending videos found, checking for waiting tasks')
    synthesisNext()

    setTimeout(() => {
      loopPending()
    }, 2000)
    return
  }

  log.info('Checking video task status', {
    videoId: video.id,
    taskCode: video.code,
    currentStatus: video.status
  })
  const startTime = Date.now()
  const statusRes = await getVideoStatus(video.code)
  const elapsedMs = Date.now() - startTime
  log.debug('Video status API response', {
    videoId: video.id,
    statusCode: statusRes.code,
    elapsedMs,
    response: statusRes.data
  })

  if ([9999, 10002, 10003].includes(statusRes.code)) {
    log.error('Video task failed', {
      videoId: video.id,
      errorCode: statusRes.code,
      errorMessage: statusRes.msg
    })
    updateStatus(video.id, 'failed', statusRes.msg)
  } else if (statusRes.code === 10000) {
    if (statusRes.data.status === 1) {
      log.debug('Video task in progress', {
        videoId: video.id,
        progress: statusRes.data.progress,
        message: statusRes.data.msg
      })
      updateStatus(
        video.id,
        'pending',
        statusRes.data.msg,
        statusRes.data.progress,
      )
    } else if (statusRes.data.status === 2) { // 合成成功
      log.info('Video synthesis completed successfully', {
        videoId: video.id,
        resultPath: statusRes.data.result
      })

      // 如果是远程存储，下载到本地
      if (remoteStorageConfig.enabled) {
        const resultPath = path.join(assetPath.model, statusRes.data.result)
        await remoteStorage.download(path.join(path.relative(assetPath.dataRoot, assetPath.model), statusRes.data.result), resultPath)
      }
      
      // ffmpeg 获取视频时长
      let duration
      if(process.env.NODE_ENV === 'development'){
        duration = 88
        log.debug('Using mock duration in development mode')
      }else{
        const resultPath = path.join(assetPath.model, statusRes.data.result)
        duration = await getVideoDuration(resultPath)
      }

      update({
        id: video.id,
        status: 'success',
        message: statusRes.data.msg,
        progress: statusRes.data.progress,
        file_path: statusRes.data.result,
        duration
      })
      log.info('Video status updated to success', {
        videoId: video.id,
        duration,
        filePath: statusRes.data.result
      })

    } else if (statusRes.data.status === 3) {
      log.error('Video task failed', {
        videoId: video.id,
        errorMessage: statusRes.data.msg
      })
      updateStatus(video.id, 'failed', statusRes.data.msg)
    }
  }

  setTimeout(() => {
    loopPending()
  }, 2000)
  return video
}

/**
 * 合成下一个视频
 */
function synthesisNext() {
  // 查询所有未完成的视频任务
  const video = findFirstByStatus('waiting')
  if (video) {
    synthesisVideo(video.id)
  }
}

function removeVideo(videoId) {
  // 查询视频
  const video = selectVideoByID(videoId)
  log.debug('~ removeVideo ~ videoId:', videoId)

  // 删除视频
  const videoPath = path.join(assetPath.model, video.file_path ||'')
  if (!isEmpty(video.file_path) && fs.existsSync(videoPath)) {
    fs.unlinkSync(videoPath)
  }

  // 删除音频
  const audioPath = path.join(assetPath.model, video.audio_path ||'')
  if (!isEmpty(video.audio_path) && fs.existsSync(audioPath)) {
    fs.unlinkSync(audioPath)
  }

  // 删除视频表
  return deleteVideo(videoId)
}

function exportVideo(videoId, outputPath) {
  const video = selectVideoByID(videoId)
  const filePath = path.join(assetPath.model, video.file_path)
  fs.copyFileSync(filePath, outputPath)
}

/**
 * 调用face2face生成视频
 * @param {string} audioPath
 * @param {string} videoPath
 * @returns
 */
async function makeVideoByF2F(audioPath, videoPath) {
  const uuid = crypto.randomUUID()
  
  // 在启用远程存储时获取完整URL
  let audioUrl = audioPath
  let videoUrl = videoPath

  if (remoteStorageConfig.enabled) {
    audioUrl = path.relative(assetPath.dataRoot, path.join(assetPath.ttsProduct, audioPath))
    // 上传音频
    await remoteStorage.upload(audioUrl, path.join(assetPath.ttsProduct, audioPath))
    videoUrl = path.relative(assetPath.dataRoot, videoPath)
  }

  const param = {
    audio_url: audioPath,
    video_url: videoUrl,
    code: uuid,
    chaofen: 0,
    watermark_switch: 0,
    pn: 1
  }
  const result = await makeVideoApi(param)
  return { param, result }
}

function modify(video) {
  return update(video)
}

export function init() {
  ipcMain.handle(MODEL_NAME + '/page', (event, ...args) => {
    return page(...args)
  })
  ipcMain.handle(MODEL_NAME + '/make', (event, ...args) => {
    return makeVideo(...args)
  })
  ipcMain.handle(MODEL_NAME + '/modify', (event, ...args) => {
    return modify(...args)
  })
  ipcMain.handle(MODEL_NAME + '/save', (event, ...args) => {
    return saveVideo(...args)
  })
  ipcMain.handle(MODEL_NAME + '/find', (event, ...args) => {
    return findVideo(...args)
  })
  ipcMain.handle(MODEL_NAME + '/count', (event, ...args) => {
    return countVideo(...args)
  })
  ipcMain.handle(MODEL_NAME + '/export', async (event, ...args) => {
    return await exportVideo(...args)
  })
  ipcMain.handle(MODEL_NAME + '/remove', async (event, ...args) => {
    return await removeVideo(...args)
  })
}