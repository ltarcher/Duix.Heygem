# 配置文件说明

## 远程存储配置 (`src/main/config/config.js`)

### 参数说明
| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| enabled | boolean | `false` | 是否启用远程存储 |
| type | string | `api` | 存储类型 (minio/s3/api) |
| endpoint | string | `http://localhost:9000` | Minio/S3存储服务地址 |
| apiEndpoint | string | `http://localhost:3000` | API服务地址(type为api时使用) |
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
export REMOTE_STORAGE_TYPE=api  # 可选值: minio, api

# 设置Minio/S3服务地址
export REMOTE_STORAGE_ENDPOINT=http://your-minio-server:9000

# 设置API服务地址(type为api时使用)
export REMOTE_STORAGE_API_ENDPOINT=http://your-api-server:3000

# 设置存储区域
export REMOTE_STORAGE_REGION=us-east-1

# 设置存储桶
export REMOTE_STORAGE_BUCKET=your-bucket

# 设置访问密钥
export REMOTE_STORAGE_ACCESS_KEY=your-access-key

# 设置秘密密钥
export REMOTE_STORAGE_SECRET_KEY=your-secret-key

# 设置数据根目录
export HEYGEM_DATA_ROOT=/path/to/your/data
```

## 数据目录配置

### 数据根目录 (dataRoot)
- 默认值：当前工作目录 (process.cwd())
- 可通过 `HEYGEM_DATA_ROOT` 环境变量自定义
- 远程存储启用时，使用当前工作目录
- 所有资源路径都基于数据根目录

### 资源路径 (assetPath)
| 路径名 | 说明 | 默认值 |
|--------|------|--------|
| dataRoot | 数据根目录 | 当前工作目录 |
| model | 模特视频目录 | `${dataRoot}/heygem_data/face2face/temp` |
| ttsProduct | TTS产物目录 | `${dataRoot}/heygem_data/face2face/temp` |
| ttsRoot | TTS服务根目录 | `${dataRoot}/heygem_data/voice/data` |
| ttsTrain | TTS训练产物目录 | `${dataRoot}/heygem_data/voice/data/origin_audio` |

## 部署模式

### 单机部署
1. 设置 `REMOTE_STORAGE_ENABLED=false`
2. 所有文件将存储在本地数据目录
3. 默认使用当前工作目录作为数据根目录
4. 可通过 `HEYGEM_DATA_ROOT` 环境变量自定义数据根目录

### 前后端分离部署
1. 设置 `REMOTE_STORAGE_ENABLED=true`
2. 选择存储类型：
   - `type=minio`: 使用Minio/S3存储
   - `type=api`: 使用API服务存储
3. 根据存储类型配置相应参数：
   - Minio/S3: 配置endpoint、region等参数
   - API: 配置apiEndpoint参数
4. 确保服务间网络连通性

## 注意事项
1. 启用远程存储后，所有新生成的音频/视频文件将自动上传
2. 现有本地文件不会自动迁移，需手动处理
3. 确保网络连通性：
   - Minio模式：前端 ↔ Minio服务
   - API模式：前端 ↔ API服务
4. 生产环境建议：
   - 使用HTTPS和安全凭证
   - 设置合适的数据根目录
   - 确保数据目录具有足够的存储空间和正确的访问权限