# 配置文件说明

## 远程存储配置 (`src/main/config/config.js`)

### 参数说明
| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| enabled | boolean | `true` | 是否启用远程存储 |
| type | string | `minio` | 存储类型 (minio/s3/oss) |
| endpoint | string | `http://localhost:9000` | 存储服务地址 |
| region | string | `us-east-1` | 存储区域 |
| bucket | string | `heygemdata` | 存储桶名称 |
| accessKey | string | `myminio` | 访问密钥 |
| secretKey | string | `myminio` | 秘密密钥 |

### 环境变量支持
所有参数都支持通过环境变量配置：
```bash
# 启用远程存储
export REMOTE_STORAGE_ENABLED=true

# 设置存储类型
export REMOTE_STORAGE_TYPE=minio

# 设置服务地址
export REMOTE_STORAGE_ENDPOINT=http://your-minio-server:9000

# 设置存储区域
export REMOTE_STORAGE_REGION=us-east-1

# 设置存储桶
export REMOTE_STORAGE_BUCKET=your-bucket

# 设置访问密钥
export REMOTE_STORAGE_ACCESS_KEY=your-access-key

# 设置秘密密钥
export REMOTE_STORAGE_SECRET_KEY=your-secret-key
```

## 部署模式

### 单机部署
1. 设置 `REMOTE_STORAGE_ENABLED=false`
2. 所有文件将存储在本地 `assetPath.model` 目录

### 前后端分离部署
1. 设置 `REMOTE_STORAGE_ENABLED=true`
2. 配置正确的远程存储参数
3. 确保后端服务能访问远程存储
4. 前端通过API访问后端服务

## 注意事项
1. 启用远程存储后，所有新生成的音频/视频文件将自动上传
2. 现有本地文件不会自动迁移，需手动处理
3. 确保网络连通性：前端 ↔ 后端 ↔ 远程存储
4. 生产环境建议使用HTTPS和安全凭证