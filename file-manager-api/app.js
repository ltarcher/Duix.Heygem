const express = require('express');
const fileUpload = require('express-fileupload');
const fs = require('fs');
const path = require('path');

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
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).send('No files were uploaded.');
  }

  const file = req.files.file;
  const relativePath = req.query.path ? sanitizePath(req.query.path) : '';
  const targetDir = path.join(storagePath, relativePath);
  const filePath = path.join(targetDir, file.name);

  // 确保目标目录存在
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  file.mv(filePath, (err) => {
    if (err) {
      return res.status(500).send(err);
    }
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

  if (!filename) {
    return res.status(400).send('Filename is required');
  }

  if (fs.existsSync(filePath)) {
    res.download(filePath, filename);
  } else {
    res.status(404).send('File not found');
  }
});

// 文件列表接口（支持相对路径）
app.get('/files', (req, res) => {
  const relativePath = req.query.path ? sanitizePath(req.query.path) : '';
  const targetDir = path.join(storagePath, relativePath);

  if (!fs.existsSync(targetDir)) {
    return res.status(404).send('Directory not found');
  }

  fs.readdir(targetDir, (err, files) => {
    if (err) {
      return res.status(500).send('Unable to scan directory');
    }
    res.send(files);
  });
});

// 健康检查接口
app.get('/health', (req, res) => {
  res.send('OK');
});

app.listen(port, () => {
  console.log(`File Manager API running on port ${port}`);
  console.log(`Storage path: ${path.resolve(storagePath)}`);
});