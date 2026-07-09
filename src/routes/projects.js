const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const sanitize = require('sanitize-filename');
const repo = require('../db/repository');

const router = express.Router();
const uploadDir = path.join(process.cwd(), 'uploads', 'covers');
fs.mkdirSync(uploadDir, { recursive: true });

const coverUpload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${sanitize(file.originalname)}`)
  }),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    cb(allowed.includes(file.mimetype) ? null : new Error('Cover must be JPG, PNG, or WebP.'), allowed.includes(file.mimetype));
  }
});

function payload(body, coverPath = null) {
  const bookType = body.book_type === 'non_fiction' ? 'non_fiction' : 'fiction';
  return {
    title: String(body.title || '').trim(),
    subtitle: String(body.subtitle || '').trim(),
    author: String(body.author || '').trim(),
    description: String(body.description || '').trim(),
    guidance_prompt: String(body.guidance_prompt || '').trim(),
    target_language: String(body.target_language || 'English').trim(),
    target_word_count: Math.max(1000, Number(body.target_word_count || 50000)),
    target_chapter_count: Math.max(1, Math.min(100, Number(body.target_chapter_count || 10))),
    genre: String(body.genre || '').trim(),
    tone: String(body.tone || '').trim(),
    audience: String(body.audience || '').trim(),
    book_type: bookType,
    cover_image_path: coverPath
  };
}

router.get('/', (req, res) => {
  res.render('projects/index', { pageTitle: 'Projects', projects: repo.listProjects() });
});

router.get('/new', (req, res) => {
  res.render('projects/form', { pageTitle: 'New Project', project: null });
});

router.post('/', coverUpload.single('cover_image'), (req, res) => {
  if (!String(req.body.title || '').trim()) throw new Error('Project title is required.');
  const coverPath = req.file ? path.relative(process.cwd(), req.file.path) : null;
  const id = repo.createProject(payload(req.body, coverPath));
  res.redirect(`/projects/${id}?success=${encodeURIComponent('Project created')}`);
});

router.get('/:id', (req, res) => {
  const project = repo.getProject(req.params.id);
  if (!project) return res.status(404).send('Project not found');
  res.render('projects/show', {
    pageTitle: project.title,
    project,
    files: repo.listProjectFiles(project.id),
    plan: repo.getBookPlan(project.id),
    chapters: repo.listChapters(project.id),
    logs: repo.listLogs(project.id)
  });
});

router.get('/:id/edit', (req, res) => {
  const project = repo.getProject(req.params.id);
  if (!project) return res.status(404).send('Project not found');
  res.render('projects/form', { pageTitle: 'Edit Project', project });
});

router.put('/:id', coverUpload.single('cover_image'), (req, res) => {
  if (!String(req.body.title || '').trim()) throw new Error('Project title is required.');
  const coverPath = req.file ? path.relative(process.cwd(), req.file.path) : null;
  repo.updateProject(req.params.id, payload(req.body, coverPath));
  res.redirect(`/projects/${req.params.id}?success=${encodeURIComponent('Project updated')}`);
});

router.delete('/:id', (req, res) => {
  repo.deleteProject(req.params.id);
  res.redirect('/projects?success=Project%20deleted');
});

module.exports = router;
