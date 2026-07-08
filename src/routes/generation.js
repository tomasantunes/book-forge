const express = require('express');
const repo = require('../db/repository');
const generation = require('../services/generationService');

const router = express.Router({ mergeParams: true });

router.post('/plan', async (req, res, next) => {
  try {
    await generation.generatePlan(req.params.projectId);
    res.redirect(`/projects/${req.params.projectId}?success=${encodeURIComponent('Book plan generated')}`);
  } catch (error) {
    repo.addLog(req.params.projectId, 'book_plan', 'failed', error.message);
    next(error);
  }
});

router.post('/chapters', async (req, res, next) => {
  try {
    await generation.generateAllChapters(req.params.projectId);
    res.redirect(`/projects/${req.params.projectId}/chapters?success=${encodeURIComponent('Chapters generated')}`);
  } catch (error) {
    repo.addLog(req.params.projectId, 'chapter_generation', 'failed', error.message);
    next(error);
  }
});

module.exports = router;
