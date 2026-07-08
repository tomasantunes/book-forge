const repo = require('../db/repository');
const ai = require('./openaiService');

function requireProject(projectId) {
  const project = repo.getProject(projectId);
  if (!project) throw new Error('Project not found');
  if (!project.guidance_prompt && !project.description) {
    throw new Error('Add a description or guidance prompt before generation.');
  }
  return project;
}

async function generatePlan(projectId) {
  const project = requireProject(projectId);
  const files = repo.listProjectFiles(projectId);
  repo.addLog(projectId, 'source_summaries', 'running', 'Summarizing uploaded files');

  for (const file of files) {
    if (!file.summary) {
      const summary = await ai.summarizeSourceFile(file);
      repo.updateFileSummary(file.id, summary);
    }
  }

  const summarizedFiles = repo.listProjectFiles(projectId);
  repo.addLog(projectId, 'book_plan', 'running', 'Generating book plan');
  const plan = await ai.generateBookPlan(project, summarizedFiles);
  const planId = repo.upsertBookPlan(projectId, plan);
  repo.addLog(projectId, 'book_plan', 'success', 'Book plan generated');
  return planId;
}

async function ensureChapterOutlines(project, plan) {
  const target = Number(project.target_chapter_count || 1);
  for (let chapterNumber = 1; chapterNumber <= target; chapterNumber += 1) {
    const existing = repo.getChapterByNumber(project.id, chapterNumber);
    if (!existing || !existing.outline) {
      repo.addLog(project.id, 'chapter_outline', 'running', `Generating outline for chapter ${chapterNumber}`);
      const outline = await ai.generateChapterOutline(project, plan, chapterNumber);
      repo.upsertChapter(project.id, {
        chapter_number: chapterNumber,
        title: outline.title || `Chapter ${chapterNumber}`,
        outline: outline.outline || '',
        content: existing?.content || '',
        summary: existing?.summary || '',
        status: existing?.status || 'planned'
      });
    }
  }
}

async function generateSingleChapter(projectId, chapterNumber, force = false) {
  const project = requireProject(projectId);
  let plan = repo.getBookPlan(projectId);
  if (!plan) {
    await generatePlan(projectId);
    plan = repo.getBookPlan(projectId);
  }

  await ensureChapterOutlines(project, plan);

  const files = repo.listProjectFiles(projectId);
  const chapter = repo.getChapterByNumber(projectId, chapterNumber);
  if (!chapter) throw new Error(`Chapter ${chapterNumber} does not exist`);
  if (chapter.content && !force) return chapter.id;

  const previousChapter = repo.getPreviousChapter(projectId, chapterNumber);
  repo.addLog(projectId, 'chapter_generation', 'running', `Generating chapter ${chapterNumber}`, chapter.id);
  const content = await ai.generateChapter(project, plan, files, chapter, previousChapter);
  repo.upsertChapter(projectId, { ...chapter, content, status: 'generated' });

  const savedChapter = repo.getChapterByNumber(projectId, chapterNumber);
  repo.addLog(projectId, 'chapter_summary', 'running', `Summarizing chapter ${chapterNumber}`, savedChapter.id);
  const summary = await ai.summarizeChapter(savedChapter);
  repo.upsertChapter(projectId, { ...savedChapter, summary, status: 'generated' });

  const finalChapter = repo.getChapterByNumber(projectId, chapterNumber);
  const continuity = await ai.updateContinuity(project, repo.getBookPlan(projectId), finalChapter);
  repo.updateContinuity(projectId, continuity.continuity_notes || '', continuity.book_bible || null);
  repo.addLog(projectId, 'chapter_generation', 'success', `Chapter ${chapterNumber} generated`, savedChapter.id);
  return savedChapter.id;
}

async function generateAllChapters(projectId) {
  const project = requireProject(projectId);
  let plan = repo.getBookPlan(projectId);
  if (!plan) {
    await generatePlan(projectId);
    plan = repo.getBookPlan(projectId);
  }
  await ensureChapterOutlines(project, plan);

  const total = Number(project.target_chapter_count || 1);
  for (let chapterNumber = 1; chapterNumber <= total; chapterNumber += 1) {
    await generateSingleChapter(projectId, chapterNumber, false);
  }
}

module.exports = {
  generatePlan,
  generateSingleChapter,
  generateAllChapters
};
