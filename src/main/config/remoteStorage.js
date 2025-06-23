import axios from 'axios'
import FormData from 'form-data'
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { remoteStorageConfig } from './config.js'
import path from 'path'
import fs from 'fs'
// 根据配置类型选择存储方式
let storageAdapter

if (remoteStorageConfig.type === 'api') {
  // API存储适配器
  storageAdapter = {
    async upload(key, file) {
      const formData = new FormData()
      formData.append('file', fs.createReadStream(file))
      formData.append('path', path.dirname(key))

      const response = await axios.post(
        `${remoteStorageConfig.apiEndpoint}/upload`,
        formData,
        {
          headers: formData.getHeaders()
        }
      )

      return `${remoteStorageConfig.apiEndpoint}/download?filename=${path.basename(key)}&path=${path.dirname(key)}`
    },

    async download(key, localPath) {
      const response = await axios.get(
        `${remoteStorageConfig.apiEndpoint}/download`,
        {
          params: {
            filename: path.basename(key),
            path: path.dirname(key)
          },
          responseType: 'stream'
        }
      )

      const dir = path.dirname(localPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      
      const writer = fs.createWriteStream(localPath)
      response.data.pipe(writer)
      
      return new Promise((resolve, reject) => {
        writer.on('finish', resolve)
        writer.on('error', reject)
      })
    },

    async delete(key) {
      await axios.delete(
        `${remoteStorageConfig.apiEndpoint}/delete`,
        {
          data: {
            filename: path.basename(key),
            path: path.dirname(key)
          }
        }
      )
    }
  }
} else {
  // S3/Minio存储适配器
  const s3Client = new S3Client({
    region: remoteStorageConfig.region,
    endpoint: remoteStorageConfig.endpoint,
    credentials: {
      accessKeyId: remoteStorageConfig.accessKey,
      secretAccessKey: remoteStorageConfig.secretKey
    },
    forcePathStyle: true
  })

  storageAdapter = {
    async upload(key, file) {
      let fileContent = file
      if (typeof file === 'string') {
        fileContent = fs.readFileSync(file)
      }

      const params = {
        Bucket: remoteStorageConfig.bucket,
        Key: key,
        Body: fileContent
      }

      await s3Client.send(new PutObjectCommand(params))
      return `${remoteStorageConfig.endpoint}/${remoteStorageConfig.bucket}/${key}`
    },

    async download(key, localPath) {
      const params = {
        Bucket: remoteStorageConfig.bucket,
        Key: key
      }

      const { Body } = await s3Client.send(new GetObjectCommand(params))
      const dir = path.dirname(localPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(localPath, await Body.transformToByteArray())
    },

    async delete(key) {
      const params = {
        Bucket: remoteStorageConfig.bucket,
        Key: key
      }
      await s3Client.send(new DeleteObjectCommand(params))
    }
  }
}

export class RemoteStorage {
  constructor() {
    this.bucket = remoteStorageConfig.bucket
  }

  async upload(key, file) {
    return storageAdapter.upload(key, file)
  }

  async download(key, localPath) {
    return storageAdapter.download(key, localPath)
  }

  async delete(key) {
    return storageAdapter.delete(key)
  }

  getUrl(key) {
    if (remoteStorageConfig.type === 'api') {
      return `${remoteStorageConfig.apiEndpoint}/download?filename=${path.basename(key)}&path=${path.dirname(key)}`
    } else {
      return `${remoteStorageConfig.endpoint}/${remoteStorageConfig.bucket}/${key}`
    }
  }
}

// 默认导出实例
export const remoteStorage = new RemoteStorage()

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
