const express = require('express');
const generation = require('../services/generationService');

const router = express.Router({ mergeParams: true });

router.post('/plan', async (req, res, next) => {
  if (generation.isPlanGenerationRunning(req.params.projectId)) {
    return res.redirect(`/projects/${req.params.projectId}?error=${encodeURIComponent('A book plan is already being generated. Progress is shown in the generation log.')}`);
  }
  generation.generatePlan(req.params.projectId).catch((error) => console.error('Book plan generation failed:', error));
  return res.redirect(`/projects/${req.params.projectId}?success=${encodeURIComponent('Book plan generation started. This page will refresh while it runs.')}`);
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
