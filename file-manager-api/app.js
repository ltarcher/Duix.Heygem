const express = require('express');
const fileUpload = require('express-fileupload');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const app = express();
const port = process.env.PORT || 3000;
const storagePath = process.env.STORAGE_PATH || './storage';

// 确保存储目录存在
if (!fs.existsSync(storagePath)) {
  fs.mkdirSync(storagePath, { recursive: true });
}

app.use(fileUpload());
app.use(express.json());

// 安全路径验证函数
function sanitizePath(relativePath) {
  return relativePath.replace(/\.\./g, '').replace(/\\/g, '/');
}

// 文件上传接口（支持相对路径）
app.post('/upload', (req, res) => {
  logger.info(`API: /upload - Start uploading file`);

  if (!req.files || Object.keys(req.files).length === 0) {
    logger.error('API: /upload - No files were uploaded');
    return res.status(400).send('No files were uploaded.');
  }

  const file = req.files.file;
  const relativePath = req.query.path ? sanitizePath(req.query.path) : '';
  const targetDir = path.join(storagePath, relativePath);
  const filePath = path.join(targetDir, file.name);

  logger.info(`API: /upload - Parameters: filename=${file.name}, path=${relativePath}`);

  // 确保目标目录存在
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  file.mv(filePath, (err) => {
    if (err) {
      logger.error(`API: /upload - Error: ${err.message}`);
      return res.status(500).send(err);
    }
    logger.info(`API: /upload - Success: File "${file.name}" uploaded to "${relativePath}"`);
    res.send({
      message: 'File uploaded!',
      filename: file.name,
      path: relativePath
    });
  });
});

// 文件下载接口（支持相对路径）
app.get('/download', (req, res) => {
  const filename = req.query.filename;
  const relativePath = req.query.path ? sanitizePath(req.query.path) : '';
  const filePath = path.join(storagePath, relativePath, filename);

  logger.info(`API: /download - Parameters: filename=${filename || 'undefined'}, path=${relativePath}`);

  if (!filename) {
    logger.error('API: /download - Error: Filename is required');
    return res.status(400).send('Filename is required');
  }

  if (fs.existsSync(filePath)) {
    logger.info(`API: /download - Success: Downloading file "${filename}" from "${relativePath}"`);
    res.download(filePath, filename, (err) => {
      if (err) {
        logger.error(`API: /download - Error during download: ${err.message}`);
      }
    });
  } else {
    logger.error(`API: /download - Error: File "${filename}" not found in "${relativePath}"`);
    res.status(404).send('File not found');
  }
});

// 文件列表接口（支持相对路径）
app.get('/files', (req, res) => {
  const relativePath = req.query.path ? sanitizePath(req.query.path) : '';
  const targetDir = path.join(storagePath, relativePath);

  logger.info(`API: /files - Parameters: path=${relativePath}`);

  if (!fs.existsSync(targetDir)) {
    logger.error(`API: /files - Error: Directory "${relativePath}" not found`);
    return res.status(404).send('Directory not found');
  }

  fs.readdir(targetDir, (err, files) => {
    if (err) {
      logger.error(`API: /files - Error scanning directory: ${err.message}`);
      return res.status(500).send('Unable to scan directory');
    }
    logger.info(`API: /files - Success: Found ${files.length} files ${files} in "${relativePath}"`);
    res.send(files);
  });
});

// 文件删除接口（支持相对路径）
app.delete('/delete', (req, res) => {
  const filename = req.query.filename;
  const relativePath = req.query.path ? sanitizePath(req.query.path) : '';
  const filePath = path.join(storagePath, relativePath, filename);

  logger.info(`API: /delete - Parameters: filename=${filename || 'undefined'}, path=${relativePath}`);

  if (!filename) {
    logger.error('API: /delete - Error: Filename is required');
    return res.status(400).send('Filename is required');
  }

  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      logger.info(`API: /delete - Success: File "${filename}" deleted from "${relativePath}"`);
      res.send({ message: 'File deleted successfully' });
    } catch (err) {
      logger.error(`API: /delete - Error deleting file: ${err.message}`);
      res.status(500).send(`Error deleting file: ${err.message}`);
    }
  } else {
    logger.error(`API: /delete - Error: File "${filename}" not found in "${relativePath}"`);
    res.status(404).send('File not found');
  }
});

// 创建目录接口（支持相对路径）
app.post('/mkdir', (req, res) => {
  const dirName = req.query.dirname;
  const relativePath = req.query.path ? sanitizePath(req.query.path) : '';
  const targetDir = path.join(storagePath, relativePath, dirName);

  logger.info(`API: /mkdir - Parameters: dirname=${dirName || 'undefined'}, path=${relativePath}`);

  if (!dirName) {
    logger.error('API: /mkdir - Error: Directory name is required');
    return res.status(400).send('Directory name is required');
  }

  if (fs.existsSync(targetDir)) {
    logger.error(`API: /mkdir - Error: Directory "${dirName}" already exists in "${relativePath}"`);
    return res.status(400).send('Directory already exists');
  }

  try {
    fs.mkdirSync(targetDir, { recursive: true });
    logger.info(`API: /mkdir - Success: Directory "${dirName}" created in "${relativePath}"`);
    res.send({ message: 'Directory created successfully' });
  } catch (err) {
    logger.error(`API: /mkdir - Error creating directory: ${err.message}`);
    res.status(500).send(`Error creating directory: ${err.message}`);
  }
});

// 健康检查接口
app.get('/health', (req, res) => {
  logger.info('API: /health - Health check requested');
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
  logger.info('API: /health - Success: Health check passed');
});

// 全局错误处理中间件
app.use((err, req, res, next) => {
  logger.error(`Unhandled Error: ${err.message}`);
  logger.error(err.stack);
  res.status(500).send('Internal Server Error');
});

app.listen(port, () => {
  logger.info(`File Manager API started - Port: ${port}, Storage: ${path.resolve(storagePath)}`);
  console.log(`File Manager API running on port ${port}`);
  console.log(`Storage path: ${path.resolve(storagePath)}`);
});