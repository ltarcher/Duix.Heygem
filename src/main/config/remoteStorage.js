import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { fromIni } from '@aws-sdk/credential-provider-ini'
import path from 'path'
import fs from 'fs'

// 从环境变量或配置文件获取配置
// 支持Minio配置示例:
//   OSS_ENDPOINT=http://minio-server:9000
//   OSS_REGION=us-east-1
//   OSS_BUCKET=my-bucket
//   OSS_PROFILE=minio-user
const config = {
  region: process.env.OSS_REGION,
  endpoint: process.env.OSS_ENDPOINT,
  credentials: fromIni({ profile: process.env.OSS_PROFILE }),
  forcePathStyle: true // Minio需要此设置
}

const s3Client = new S3Client(config)

export class RemoteStorage {
  constructor(bucketName) {
    this.bucket = bucketName || process.env.OSS_BUCKET
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