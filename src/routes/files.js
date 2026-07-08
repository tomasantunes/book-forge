const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const sanitize = require('sanitize-filename');
const repo = require('../db/repository');

const router = express.Router({ mergeParams: true });
const uploadDir = path.join(process.cwd(), 'uploads', 'sources');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${sanitize(file.originalname)}`)
  }),
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024,
    files: 20
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.txt', '.md'].includes(ext);
    cb(allowed ? null : new Error('Only .txt and .md source files are allowed.'), allowed);
  }
});

router.post('/', upload.array('source_files', 20), (req, res) => {
  const project = repo.getProject(req.params.projectId);
  if (!project) return res.status(404).send('Project not found');
  if (!req.files?.length) throw new Error('Choose at least one .txt or .md file.');

  for (const file of req.files) {
    const extractedText = fs.readFileSync(file.path, 'utf8').trim();
    if (!extractedText) {
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
