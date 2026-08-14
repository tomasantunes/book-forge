const repo = require('../db/repository');
const ai = require('./openaiService');

const activePlanJobs = new Set();
const summaryConcurrency = Math.max(1, Math.min(10, Number(process.env.SUMMARY_CONCURRENCY || 4)));
const batchCharacterLimit = Math.max(10000, Number(process.env.SUMMARY_BATCH_CHARACTERS || 60000));
const finalSourceCharacterLimit = Math.max(20000, Number(process.env.PLAN_SOURCE_CHARACTERS || 120000));

function reportPlanProgress(projectId, step, status, message) {
  repo.addLog(projectId, step, status, message);
  const method = status === 'failed' ? 'error' : 'log';
  console[method](`[Book plan][project ${projectId}][${step}][${status}] ${message}`);
}

function reportChapterProgress(projectId, step, status, message, chapterId = null) {
  repo.addLog(projectId, step, status, message, chapterId);
  const method = status === 'failed' ? 'error' : 'log';
  console[method](`[Chapters][project ${projectId}][${step}][${status}] ${message}`);
}

function requireProject(projectId) {
  const project = repo.getProject(projectId);
  if (!project) throw new Error('Project not found');
  if (!project.guidance_prompt && !project.description) {
    throw new Error('Add a description or guidance prompt before generation.');
  }
  return project;
}

function splitByCharacterLimit(items, limit) {
  const batches = [];
  let batch = [];
  let length = 0;
  for (const item of items) {
    if (batch.length && length + item.length > limit) {
      batches.push(batch);
      batch = [];
      length = 0;
    }
    batch.push(item);
    length += item.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

async function summarizeMissingFiles(project, files) {
  const pending = files.filter((file) => !file.summary?.trim());
  if (!pending.length) return;

  let nextIndex = 0;
  let completed = 0;
  const workers = Array.from({ length: Math.min(summaryConcurrency, pending.length) }, async () => {
    while (nextIndex < pending.length) {
      const file = pending[nextIndex];
      nextIndex += 1;
      try {
        const summary = await ai.summarizeSourceFile(file, project.book_type);
        repo.updateFileSummary(file.id, summary);
        completed += 1;
        if (completed === pending.length || completed % 25 === 0) {
          reportPlanProgress(project.id, 'source_summaries', 'running', `Analyzed ${completed} of ${pending.length} pending files (${Math.round((completed / pending.length) * 100)}%)`);
        }
      } catch (error) {
        throw new Error(`Could not analyze "${file.original_filename}": ${error.message}`);
      }
    }
  });
  const results = await Promise.allSettled(workers);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
}

async function buildPlanningSourceContext(project, files) {
  let entries = files.map((file) => `# ${file.original_filename}\n${file.summary.trim()}`);
  let level = 1;
  while (entries.join('\n\n').length > finalSourceCharacterLimit) {
    const batches = splitByCharacterLimit(entries, batchCharacterLimit);
    reportPlanProgress(project.id, 'source_consolidation', 'running', `Starting consolidation level ${level}: ${batches.length} batches`);
    const consolidated = [];
    for (let index = 0; index < batches.length; index += 1) {
      const digest = await ai.consolidateSourceSummaries(batches[index].join('\n\n'), project.book_type);
      consolidated.push(`# Consolidated source batch ${index + 1}\n${digest}`);
      const completed = index + 1;
      reportPlanProgress(
        project.id,
        'source_consolidation',
        'running',
        `Consolidation level ${level}: completed ${completed} of ${batches.length} batches (${Math.round((completed / batches.length) * 100)}%)`
      );
    }
    if (consolidated.join('\n\n').length >= entries.join('\n\n').length) {
      throw new Error('Source consolidation did not reduce the planning context enough. Reduce PLAN_SOURCE_CHARACTERS or upload smaller source files.');
    }
    entries = consolidated;
    level += 1;
  }
  return entries.join('\n\n');
}

async function generatePlan(projectId) {
  const jobKey = String(projectId);
  if (activePlanJobs.has(jobKey)) throw new Error('A book plan is already being generated for this project.');
  activePlanJobs.add(jobKey);
  try {
    const project = requireProject(projectId);
    const files = repo.listProjectFiles(projectId);
    reportPlanProgress(projectId, 'book_plan', 'running', `Book plan generation started for "${project.title}"`);
    reportPlanProgress(projectId, 'source_summaries', 'running', `Checking ${files.length} uploaded files`);
    await summarizeMissingFiles(project, files);

    const summarizedFiles = repo.listProjectFiles(projectId);
    const stillMissing = summarizedFiles.filter((file) => !file.summary?.trim());
    if (stillMissing.length) throw new Error(`${stillMissing.length} files could not be analyzed. The book plan was not generated.`);
    reportPlanProgress(projectId, 'source_summaries', 'success', `All ${summarizedFiles.length} uploaded files are analyzed`);
    const planningSources = await buildPlanningSourceContext(project, summarizedFiles);
    reportPlanProgress(projectId, 'source_consolidation', 'success', `Source context ready (${planningSources.length.toLocaleString()} characters)`);
    reportPlanProgress(projectId, 'book_plan', 'running', 'Requesting the final book plan from OpenAI');
    const plan = await ai.generateBookPlan(project, summarizedFiles, planningSources);
    if (plan.raw) {
      const error = new Error('OpenAI returned an invalid book-plan format. Completed file analyses were saved; please try generating the plan again.');
      error.generationErrorType = 'openai_api';
      throw error;
    }
    const planId = repo.upsertBookPlan(projectId, plan);
    reportPlanProgress(projectId, 'book_plan', 'success', 'Book plan generated successfully');
    return planId;
  } catch (error) {
    if (error.generationErrorType === 'connectivity') {
      reportPlanProgress(projectId, 'connectivity_error', 'failed', error.message);
    } else if (error.generationErrorType === 'openai_api') {
      reportPlanProgress(projectId, 'openai_api_error', 'failed', error.message);
    }
    reportPlanProgress(projectId, 'book_plan', 'failed', error.message);
    throw error;
  } finally {
    activePlanJobs.delete(jobKey);
  }
}

function isPlanGenerationRunning(projectId) {
  return activePlanJobs.has(String(projectId));
}

async function ensureChapterOutlines(project, plan) {
  const target = Number(project.target_chapter_count || 1);
  for (let chapterNumber = 1; chapterNumber <= target; chapterNumber += 1) {
    const existing = repo.getChapterByNumber(project.id, chapterNumber);
    if (!existing || !existing.outline) {
      reportChapterProgress(project.id, 'chapter_outline', 'running', `Generating outline for chapter ${chapterNumber} of ${target}`);
      const outline = await ai.generateChapterOutline(project, plan, chapterNumber);
      repo.upsertChapter(project.id, {
        chapter_number: chapterNumber,
        title: outline.title || `Chapter ${chapterNumber}`,
        outline: outline.outline || '',
        content: existing?.content || '',
        summary: existing?.summary || '',
        status: existing?.status || 'planned'
      });
      reportChapterProgress(project.id, 'chapter_outline', 'success', `Outline generated for chapter ${chapterNumber} of ${target}`);
    }
  }
}

async function generateSingleChapter(projectId, chapterNumber, force = false, rewritePrompt = '') {
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
  const hasSummary = Boolean(chapter.summary?.trim());
  const hasNonFictionReview = project.book_type !== 'non_fiction'
    || Boolean(chapter.claims_list?.trim() || chapter.references_needed?.trim() || chapter.factual_uncertainty_notes?.trim());
  if (chapter.content && hasSummary && hasNonFictionReview && !force) {
    reportChapterProgress(projectId, 'chapter_generation', 'success', `Skipping chapter ${chapterNumber}; saved content already exists`, chapter.id);
    return chapter.id;
  }

  if (chapter.content && !force) {
    reportChapterProgress(projectId, 'chapter_generation', 'running', `Resuming post-processing for chapter ${chapterNumber}; saved content will not be rewritten`, chapter.id);
  } else {
    const previousChapter = repo.getPreviousChapter(projectId, chapterNumber);
    reportChapterProgress(projectId, 'chapter_generation', 'running', `Writing chapter ${chapterNumber} of ${project.target_chapter_count}`, chapter.id);
    const content = await ai.generateChapter(project, plan, files, chapter, previousChapter, rewritePrompt);
    repo.upsertChapter(projectId, { ...chapter, content, status: 'generated' });
  }

  let savedChapter = repo.getChapterByNumber(projectId, chapterNumber);
  if (!savedChapter.summary?.trim() || force) {
    reportChapterProgress(projectId, 'chapter_summary', 'running', `Summarizing chapter ${chapterNumber} of ${project.target_chapter_count}`, savedChapter.id);
    const summary = await ai.summarizeChapter(savedChapter, project);
    repo.upsertChapter(projectId, { ...savedChapter, summary, status: 'generated' });
    reportChapterProgress(projectId, 'chapter_summary', 'success', `Summary completed for chapter ${chapterNumber}`, savedChapter.id);
    savedChapter = repo.getChapterByNumber(projectId, chapterNumber);
  }

  const finalChapter = savedChapter;
  if (project.book_type === 'non_fiction') {
    if (!hasNonFictionReview || force || !chapter.content) {
      reportChapterProgress(projectId, 'chapter_review', 'running', `Reviewing claims and factual uncertainty for chapter ${chapterNumber}`, finalChapter.id);
      const audit = await ai.analyzeNonFictionChapter(project, repo.getBookPlan(projectId), finalChapter);
      repo.upsertChapter(projectId, { ...finalChapter, ...audit, status: 'generated' });
      reportChapterProgress(projectId, 'chapter_review', 'success', `Review completed for chapter ${chapterNumber}`, finalChapter.id);
    }
  } else {
    reportChapterProgress(projectId, 'chapter_continuity', 'running', `Updating continuity after chapter ${chapterNumber}`, finalChapter.id);
    const continuity = await ai.updateContinuity(project, repo.getBookPlan(projectId), finalChapter);
    repo.updateContinuity(projectId, continuity.continuity_notes || '', continuity.book_bible || null);
    reportChapterProgress(projectId, 'chapter_continuity', 'success', `Continuity updated after chapter ${chapterNumber}`, finalChapter.id);
  }
  reportChapterProgress(projectId, 'chapter_generation', 'success', `Chapter ${chapterNumber} of ${project.target_chapter_count} generated`, savedChapter.id);
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
  const existingCount = repo.listChapters(projectId).filter((chapter) => chapter.content?.trim()).length;
  reportChapterProgress(
    projectId,
    'chapter_generation',
    'running',
    `Starting chapter generation: ${existingCount} of ${total} already completed; ${Math.max(0, total - existingCount)} remaining`
  );
  for (let chapterNumber = 1; chapterNumber <= total; chapterNumber += 1) {
    await generateSingleChapter(projectId, chapterNumber, false);
  }

  if (project.book_type === 'non_fiction') {
    reportChapterProgress(projectId, 'fact_check_review', 'running', 'Reviewing full-book consistency and factual uncertainty');
    const review = await ai.reviewNonFictionBook(project, repo.getBookPlan(projectId), repo.listChapters(projectId));
    repo.updateNonFictionReview(projectId, review);
    reportChapterProgress(projectId, 'fact_check_review', 'success', 'Consistency and fact-checking review completed');
  }
  reportChapterProgress(projectId, 'chapter_generation', 'success', `All ${total} chapters are complete`);
}

module.exports = {
  generatePlan,
  isPlanGenerationRunning,
  generateSingleChapter,
  generateAllChapters
};
