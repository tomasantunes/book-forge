const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const sanitize = require('sanitize-filename');
const repo = require('../db/repository');

const router = express.Router({ mergeParams: true });
const uploadDir = path.join(process.cwd(), 'uploads', 'sources');
const maxSourceFiles = Math.max(1, Number.parseInt(process.env.MAX_SOURCE_FILES, 10) || 2000);
const textExtensions = new Set(['.txt', '.md']);
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
      const safeName = sanitize(file.originalname) || 'source-file';
      cb(null, `${Date.now()}-${crypto.randomUUID()}-${safeName}`);
    }
  }),
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024,
    files: maxSourceFiles
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = textExtensions.has(ext) || imageExtensions.has(ext);
    cb(allowed ? null : new Error('Only .txt, .md, PNG, JPEG, WebP, and GIF source files are allowed.'), allowed);
  }
});

router.post('/', upload.array('source_files', maxSourceFiles), (req, res) => {
  const project = repo.getProject(req.params.projectId);
  if (!project) return res.status(404).send('Project not found');
  if (!req.files?.length) throw new Error('Choose at least one text, Markdown, or image file.');

  for (const file of req.files) {
    const ext = path.extname(file.originalname).toLowerCase();
    const isImage = imageExtensions.has(ext);
    const extractedText = isImage
      ? `[Image source: ${file.originalname}]`
      : fs.readFileSync(file.path, 'utf8').trim();
    if (!isImage && !extractedText) {
      fs.unlinkSync(file.path);
      continue;
    }
    repo.addProjectFile({
      project_id: project.id,
      original_filename: file.originalname,
      file_path: path.relative(process.cwd(), file.path),
      extracted_text: extractedText
    });
  }

  res.redirect(`/projects/${project.id}?success=${encodeURIComponent('Source files uploaded')}`);
});

router.delete('/:fileId', (req, res) => {
  const file = repo.getProjectFile(req.params.fileId);
  if (file && Number(file.project_id) === Number(req.params.projectId)) {
    const absolute = path.resolve(process.cwd(), file.file_path);
    if (absolute.startsWith(path.resolve(process.cwd(), 'uploads')) && fs.existsSync(absolute)) {
      fs.unlinkSync(absolute);
    }
    repo.deleteProjectFile(req.params.projectId, req.params.fileId);
  }
  res.redirect(`/projects/${req.params.projectId}?success=${encodeURIComponent('Source file removed')}`);
});

module.exports = router;
