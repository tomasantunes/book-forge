const express = require('express');
const repo = require('../db/repository');
const generation = require('../services/generationService');

const router = express.Router({ mergeParams: true });

router.get('/', (req, res) => {
  const project = repo.getProject(req.params.projectId);
  if (!project) return res.status(404).send('Project not found');
  res.render('chapters/index', {
    pageTitle: `${project.title} Chapters`,
    project,
    chapters: repo.listChapters(project.id)
  });
});

router.get('/:chapterId/edit', (req, res) => {
  const project = repo.getProject(req.params.projectId);
  const chapter = repo.getChapter(req.params.chapterId);
  if (!project || !chapter || Number(chapter.project_id) !== Number(project.id)) {
    return res.status(404).send('Chapter not found');
  }
  res.render('chapters/edit', { pageTitle: `Edit ${chapter.title}`, project, chapter });
});

router.put('/:chapterId', (req, res) => {
  const chapter = repo.getChapter(req.params.chapterId);
  if (!chapter || Number(chapter.project_id) !== Number(req.params.projectId)) {
    return res.status(404).send('Chapter not found');
  }
  repo.updateChapter(chapter.id, {
    title: String(req.body.title || chapter.title).trim(),
    content: String(req.body.content || ''),
    status: ['planned', 'draft', 'generated', 'approved'].includes(req.body.status)
      ? req.body.status
      : chapter.status
  });
  res.redirect(`/projects/${req.params.projectId}/chapters?success=${encodeURIComponent('Chapter saved')}`);
});

router.post('/:chapterId/regenerate', async (req, res, next) => {
  try {
    const chapter = repo.getChapter(req.params.chapterId);
    if (!chapter || Number(chapter.project_id) !== Number(req.params.projectId)) {
      return res.status(404).send('Chapter not found');
    }
    await generation.generateSingleChapter(req.params.projectId, chapter.chapter_number, true);
    res.redirect(`/projects/${req.params.projectId}/chapters/${chapter.id}/edit?success=${encodeURIComponent('Chapter regenerated')}`);
  } catch (error) {
    repo.addLog(req.params.projectId, 'chapter_regeneration', 'failed', error.message, req.params.chapterId);
    next(error);
  }
});

router.post('/:chapterId/approve', (req, res) => {
  const chapter = repo.getChapter(req.params.chapterId);
  if (!chapter || Number(chapter.project_id) !== Number(req.params.projectId)) {
    return res.status(404).send('Chapter not found');
  }
  repo.updateChapter(chapter.id, { title: chapter.title, content: chapter.content, status: 'approved' });
  res.redirect(`/projects/${req.params.projectId}/chapters?success=${encodeURIComponent('Chapter approved')}`);
});

module.exports = router;
