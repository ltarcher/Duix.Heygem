import axios from 'axios'
import FormData from 'form-data'
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { remoteStorageConfig } from './config.js'
import path from 'path'
import fs from 'fs'
import log from '../logger.js'
// 根据配置类型选择存储方式
let storageAdapter

if (remoteStorageConfig.type === 'api') {
  // API存储适配器
  storageAdapter = {
    async upload(key, file) {
      const startTime = Date.now();
      log.debug('[API Storage] Starting file upload', {
        key,
        file,
        size: fs.statSync(file).size,
        endpoint: remoteStorageConfig.apiEndpoint
      });

      try {
        const formData = new FormData();
        
        // 在添加字段前记录日志
        log.debug('[API Storage] Creating FormData', { key });
        
        // 添加文件字段并记录
        const fileStream = fs.createReadStream(file);
        formData.append('file', fileStream);
        log.debug('[API Storage] FormData field added: file', {
          name: path.basename(file),
          size: fs.statSync(file).size,
          type: 'file'
        });
        
        // 添加路径字段并记录
        const pathValue = path.dirname(key);
        formData.append('path', pathValue);
        log.debug('[API Storage] FormData field added: path', { value: pathValue });
        
        // 记录完整的formData头信息
        const headers = formData.getHeaders();
        log.debug('[API Storage] FormData headers', {
          key,
          contentType: headers['content-type'],
          contentLength: headers['content-length'],
          boundary: formData.getBoundary()
        });

        // 记录完整的请求URL和参数
        const uploadUrl = `${remoteStorageConfig.apiEndpoint}/upload?path=${encodeURIComponent(pathValue)}`;
        log.debug('[API Storage] Request URL', {
          url: uploadUrl,
          method: 'POST'
        });

        const response = await axios.post(
          uploadUrl,
          formData,
          {
            headers: formData.getHeaders()
          }
        );

        const url = `${remoteStorageConfig.apiEndpoint}/download?filename=${path.basename(key)}&path=${path.dirname(key)}`;
        const duration = Date.now() - startTime;
        
        log.debug('[API Storage] File upload completed', {
          key,
          url,
          duration: `${duration}ms`
        });

        return url;
      } catch (error) {
        log.error('[API Storage] File upload failed', {
          key,
          file,
          error: error.message,
          duration: `${Date.now() - startTime}ms`
        });
        throw error;
      }
    },

    async download(key, localPath) {
      const startTime = Date.now();
      log.debug('[API Storage] Starting file download', {
        key,
        localPath,
        endpoint: remoteStorageConfig.apiEndpoint
      });

      let downfile, downpath;

      //key如果是以http、https开头，需要从url中解析filename和path参数
      if (key.startsWith('http://') || key.startsWith('https://')) {
        const url = new URL(key);
        downfile = url.searchParams.get('filename');
        downpath = url.searchParams.get('path');

      } else {
        downfile = path.basename(key);
        downpath = path.dirname(key);
      }

      try {
        const response = await axios.get(
          `${remoteStorageConfig.apiEndpoint}/download`,
          {
            params: {
              filename: downfile,
              path: downpath
            },
            responseType: 'stream'
          }
        );

        const dir = path.dirname(localPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
          log.debug('[API Storage] Created directory', { dir });
        }
        
        const writer = fs.createWriteStream(localPath);
        response.data.pipe(writer);
        
        return new Promise((resolve, reject) => {
          writer.on('finish', () => {
            const duration = Date.now() - startTime;
            const size = fs.statSync(localPath).size;
            log.debug('[API Storage] File download completed', {
              key,
              localPath,
              size,
              duration: `${duration}ms`
            });
            resolve();
          });
          writer.on('error', (error) => {
            log.error('[API Storage] File download failed', {
              key,
              localPath,
              error: error.message,
              duration: `${Date.now() - startTime}ms`
            });
            reject(error);
          });
        });
      } catch (error) {
        log.error('[API Storage] File download failed', {
          key,
          localPath,
          error: error.message,
          duration: `${Date.now() - startTime}ms`
        });
        throw error;
      }
    },

    async delete(key) {
      const startTime = Date.now();
      log.debug('[API Storage] Starting file deletion', {
        key,
        endpoint: remoteStorageConfig.apiEndpoint
      });

      try {
        await axios.delete(
          `${remoteStorageConfig.apiEndpoint}/delete`,
          {
            data: {
              filename: path.basename(key),
              path: path.dirname(key)
            }
          }
        );

        const duration = Date.now() - startTime;
        log.debug('[API Storage] File deletion completed', {
          key,
          duration: `${duration}ms`
        });
      } catch (error) {
        log.error('[API Storage] File deletion failed', {
          key,
          error: error.message,
          duration: `${Date.now() - startTime}ms`
        });
        throw error;
      }
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
      const startTime = Date.now();
      log.debug('[S3 Storage] Starting file upload', {
        key,
        file: typeof file === 'string' ? file : 'Buffer',
        bucket: remoteStorageConfig.bucket,
        endpoint: remoteStorageConfig.endpoint
      });

      try {
        let fileContent = file;
        let fileSize;
        if (typeof file === 'string') {
          fileContent = fs.readFileSync(file);
          fileSize = fs.statSync(file).size;
        } else {
          fileSize = file.length;
        }

        const params = {
          Bucket: remoteStorageConfig.bucket,
          Key: key,
          Body: fileContent
        };

        await s3Client.send(new PutObjectCommand(params));
        const url = `${remoteStorageConfig.endpoint}/${remoteStorageConfig.bucket}/${key}`;
        const duration = Date.now() - startTime;

        log.debug('[S3 Storage] File upload completed', {
          key,
          url,
          size: fileSize,
          duration: `${duration}ms`
        });

        return url;
      } catch (error) {
        log.error('[S3 Storage] File upload failed', {
          key,
          error: error.message,
          duration: `${Date.now() - startTime}ms`
        });
        throw error;
      }
    },

    async download(key, localPath) {
      const startTime = Date.now();
      log.debug('[S3 Storage] Starting file download', {
        key,
        localPath,
        bucket: remoteStorageConfig.bucket,
        endpoint: remoteStorageConfig.endpoint
      });

      try {
        const params = {
          Bucket: remoteStorageConfig.bucket,
          Key: key
        };

        const { Body } = await s3Client.send(new GetObjectCommand(params));
        const dir = path.dirname(localPath);
        
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
          log.debug('[S3 Storage] Created directory', { dir });
        }

        const content = await Body.transformToByteArray();
        fs.writeFileSync(localPath, content);

        const duration = Date.now() - startTime;
        const size = fs.statSync(localPath).size;

        log.debug('[S3 Storage] File download completed', {
          key,
          localPath,
          size,
          duration: `${duration}ms`
        });
      } catch (error) {
        log.error('[S3 Storage] File download failed', {
          key,
          localPath,
          error: error.message,
          duration: `${Date.now() - startTime}ms`
        });
        throw error;
      }
    },

    async delete(key) {
      const startTime = Date.now();
      log.debug('[S3 Storage] Starting file deletion', {
        key,
        bucket: remoteStorageConfig.bucket,
        endpoint: remoteStorageConfig.endpoint
      });

      try {
        const params = {
          Bucket: remoteStorageConfig.bucket,
          Key: key
        };

        await s3Client.send(new DeleteObjectCommand(params));

        const duration = Date.now() - startTime;
        log.debug('[S3 Storage] File deletion completed', {
          key,
          duration: `${duration}ms`
        });
      } catch (error) {
        log.error('[S3 Storage] File deletion failed', {
          key,
          error: error.message,
          duration: `${Date.now() - startTime}ms`
        });
        throw error;
      }
    }
  }
}

export class RemoteStorage {
  constructor() {
    this.bucket = remoteStorageConfig.bucket;
    log.debug('[RemoteStorage] Initialized', {
      type: remoteStorageConfig.type,
      bucket: this.bucket,
      endpoint: remoteStorageConfig.type === 'api' ? remoteStorageConfig.apiEndpoint : remoteStorageConfig.endpoint
    });
  }

  async upload(key, file) {
    log.debug('[RemoteStorage] Upload requested', {
      type: remoteStorageConfig.type,
      key,
      file: typeof file === 'string' ? file : 'Buffer'
    });

    try {
      const result = await storageAdapter.upload(key, file);
      log.debug('[RemoteStorage] Upload completed', {
        key,
        result
      });
      return result;
    } catch (error) {
      log.error('[RemoteStorage] Upload failed', {
        key,
        error: error.message
      });
      throw error;
    }
  }

  async download(key, localPath) {
    log.debug('[RemoteStorage] Download requested', {
      type: remoteStorageConfig.type,
      key,
      localPath
    });

    try {
      await storageAdapter.download(key, localPath);
      log.debug('[RemoteStorage] Download completed', {
        key,
        localPath,
        size: fs.existsSync(localPath) ? fs.statSync(localPath).size : 'unknown'
      });
    } catch (error) {
      log.error('[RemoteStorage] Download failed', {
        key,
        localPath,
        error: error.message
      });
      throw error;
    }
  }

  async delete(key) {
    log.debug('[RemoteStorage] Delete requested', {
      type: remoteStorageConfig.type,
      key
    });

    try {
      await storageAdapter.delete(key);
      log.debug('[RemoteStorage] Delete completed', {
        key
      });
    } catch (error) {
      log.error('[RemoteStorage] Delete failed', {
        key,
        error: error.message
      });
      throw error;
    }
  }

  getUrl(key) {
    log.debug('[RemoteStorage] GetUrl requested', {
      type: remoteStorageConfig.type,
      key
    });

    let url;
    if (remoteStorageConfig.type === 'api') {
      url = `${remoteStorageConfig.apiEndpoint}/download?filename=${path.basename(key)}&path=${path.dirname(key)}`;
    } else {
      url = `${remoteStorageConfig.endpoint}/${remoteStorageConfig.bucket}/${key}`;
    }

    log.debug('[RemoteStorage] GetUrl completed', {
      key,
      url
    });
    return url;
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