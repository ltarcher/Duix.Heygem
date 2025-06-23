import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { remoteStorageConfig } from './config.js'
import path from 'path'
import fs from 'fs'

// 使用统一配置创建S3客户端
const s3Client = new S3Client({
  region: remoteStorageConfig.region,
  endpoint: remoteStorageConfig.endpoint,
  credentials: {
    accessKeyId: remoteStorageConfig.accessKey,
    secretAccessKey: remoteStorageConfig.secretKey
  },
  forcePathStyle: true // Minio需要此设置
})

export class RemoteStorage {
  constructor() {
    this.bucket = remoteStorageConfig.bucket
  }

  /**
   * 上传文件到远程存储
   * @param {string} key - 远程存储路径 
   * @param {string|Buffer} file - 本地文件路径或文件内容
   * @returns {Promise<string>} 远程文件URL
   */
  async upload(key, file) {
    let fileContent = file
    if (typeof file === 'string') {
      fileContent = fs.readFileSync(file)
    }

    const params = {
      Bucket: this.bucket,
      Key: key,
      Body: fileContent
    }

    await s3Client.send(new PutObjectCommand(params))
    return `${this.endpoint}/${this.bucket}/${key}`
  }

  /**
   * 下载远程文件到本地
   * @param {string} key - 远程存储路径
   * @param {string} localPath - 本地保存路径
   */
  async download(key, localPath) {
    const params = {
      Bucket: this.bucket,
      Key: key
    }

    const { Body } = await s3Client.send(new GetObjectCommand(params))
    const dir = path.dirname(localPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(localPath, await Body.transformToByteArray())
  }

  /**
   * 删除远程文件
   * @param {string} key - 远程存储路径
   */
  async delete(key) {
    const params = {
      Bucket: this.bucket,
      Key: key
    }
    await s3Client.send(new DeleteObjectCommand(params))
  }
}

// 默认导出实例
export const remoteStorage = new RemoteStorage()