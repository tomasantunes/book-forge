const express = require('express');
const repo = require('../db/repository');
const pdf = require('../services/pdfService');

const router = express.Router({ mergeParams: true });

function exportable(projectId) {
  return repo.listChapters(projectId).filter((chapter) => chapter.content && ['generated', 'approved'].includes(chapter.status));
}

router.get('/preview', (req, res) => {
  const project = repo.getProject(req.params.projectId);
  if (!project) return res.status(404).send('Project not found');
  res.render('export/preview', {
    layout: false,
    project,
    chapters: exportable(project.id),
    previewHtml: pdf.buildPreviewHtml(project, exportable(project.id), repo.getBookPlan(project.id))
  });
});

router.post('/pdf', async (req, res, next) => {
  try {
    const project = repo.getProject(req.params.projectId);
    if (!project) return res.status(404).send('Project not found');
    const chapters = exportable(project.id);
    if (!chapters.length) throw new Error('Generate at least one chapter before exporting.');
    const outputPath = await pdf.exportPdf(project, chapters, repo.getBookPlan(project.id));
    repo.addLog(project.id, 'pdf_export', 'success', `PDF exported to ${outputPath}`);
    res.download(require('path').resolve(process.cwd(), outputPath));
  } catch (error) {
    repo.addLog(req.params.projectId, 'pdf_export', 'failed', error.message);
    next(error);
  }
});

module.exports = router;
