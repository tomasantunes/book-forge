const OpenAI = require('openai');

const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is missing. Add it to .env before running AI generation.');
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function completeText(system, user, options = {}) {
  const client = getClient();
  const response = await client.responses.create({
    model,
    temperature: options.temperature ?? 0.7,
    instructions: system,
    input: user
  });
  return response.output_text?.trim() || '';
}

async function completeJson(system, user, fallback = {}) {
  const client = getClient();
  const response = await client.responses.create({
    model,
    temperature: 0.5,
    instructions: `${system}\nReturn only valid JSON with no markdown fences.`,
    input: user
  });
  const content = response.output_text || '{}';
  try {
    return JSON.parse(content);
  } catch (error) {
    return { ...fallback, raw: content };
  }
}

function compact(text, max = 14000) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}\n\n[Content truncated for prompt size]` : text;
}

async function summarizeSourceFile(file, bookType = 'fiction') {
  const instruction = bookType === 'non_fiction'
    ? 'Analyze the source for non-fiction writing. Extract key ideas, claims, exact quotations present in the source, references, terminology, evidence, contradictions, and research gaps. Never create a quote or reference that is not in the source.'
    : 'Summarize this source for fiction planning. Preserve themes, named entities, chronology, setting, character details, and useful source facts.';
  return completeText(
    'You summarize uploaded source material for use in long-form book generation.',
    `${instruction}\n\nFilename: ${file.original_filename}\n\nContent:\n${compact(file.extracted_text)}`
  );
}

function sourceSummaries(files, max = 5000) {
  return files.map((file) => `# ${file.original_filename}\n${file.summary || compact(file.extracted_text, max)}`).join('\n\n');
}

async function generateFictionBookPlan(project, files) {
  const sources = sourceSummaries(files);
  return completeJson(
    'You are a senior book architect who creates detailed plans for complete books.',
    `Create a book plan as JSON with keys: concept, detailed_outline, chapter_list, book_bible, style_guide, character_location_notes, continuity_notes, source_summary.

Project:
Title: ${project.title}
Subtitle: ${project.subtitle || ''}
Author: ${project.author || ''}
Description: ${project.description || ''}
Guidance prompt: ${project.guidance_prompt || ''}
Language: ${project.target_language || 'English'}
Target words: ${project.target_word_count}
Target chapters: ${project.target_chapter_count}
Genre: ${project.genre || ''}
Tone: ${project.tone || ''}
Audience: ${project.audience || ''}

Source summaries:
${sources || 'No uploaded files. Use project metadata and guidance only.'}`,
    {}
  );
}

async function generateNonFictionBookPlan(project, files) {
  const sources = sourceSummaries(files);
  return completeJson(
    'You are a non-fiction editor and research architect. Build evidence-aware books from supplied material. Never invent citations, references, quotations, or facts. Mark unsupported information as needing verification. Do not create characters, plot arcs, fictional continuity, or world-building.',
    `Create a non-fiction plan as JSON using exactly these keys:
book_concept, central_thesis, target_reader, tone_and_style, table_of_contents, chapter_outlines, source_material_summary, key_terms, main_claims, research_gaps, fact_checking_notes.

table_of_contents and chapter_outlines must contain ${project.target_chapter_count} ordered entries. Each chapter outline should include a title, purpose, argument, supporting sections, relevant source material, and research notes.

Project:
Title: ${project.title}
Subtitle: ${project.subtitle || ''}
Description: ${project.description || ''}
Guidance prompt: ${project.guidance_prompt || ''}
Language: ${project.target_language || 'English'}
Target words: ${project.target_word_count}
Target chapters: ${project.target_chapter_count}
Topic/genre: ${project.genre || ''}
Tone: ${project.tone || ''}
Audience: ${project.audience || ''}

Uploaded source analysis:
${sources || 'No uploaded sources. Explicitly record the resulting research and verification gaps.'}`,
    {
      book_concept: '',
      central_thesis: '',
      target_reader: '',
      tone_and_style: '',
      table_of_contents: [],
      chapter_outlines: [],
      source_material_summary: '',
      key_terms: [],
      main_claims: [],
      research_gaps: [],
      fact_checking_notes: []
    }
  );
}

async function generateBookPlan(project, files) {
  return project.book_type === 'non_fiction'
    ? generateNonFictionBookPlan(project, files)
    : generateFictionBookPlan(project, files);
}

async function generateFictionChapterOutline(project, plan, chapterNumber) {
  return completeJson(
    'You create actionable chapter outlines for sequential book generation.',
    `Return JSON with title and outline for chapter ${chapterNumber}.

Project: ${project.title}
Target chapter count: ${project.target_chapter_count}
Book concept: ${plan.concept}
Detailed outline: ${plan.detailed_outline}
Chapter list: ${plan.chapter_list}
Book bible: ${plan.book_bible}
Style guide: ${plan.style_guide}`,
    { title: `Chapter ${chapterNumber}`, outline: '' }
  );
}

async function generateNonFictionChapterOutline(project, plan, chapterNumber) {
  return completeJson(
    'You create evidence-aware non-fiction chapter outlines. Never invent facts or references.',
    `Return JSON with title and outline for chapter ${chapterNumber}. The outline must include purpose, main argument, supporting sections, examples or evidence available, practical implications, research notes, and verification gaps.

Project: ${project.title}
Central thesis: ${plan.central_thesis || ''}
Target reader: ${plan.target_reader || project.audience || ''}
Table of contents: ${plan.chapter_list || ''}
Chapter-by-chapter plan: ${plan.detailed_outline || ''}
Source summary: ${plan.source_summary || ''}
Known claims: ${plan.main_claims || ''}
Research gaps: ${plan.research_gaps || ''}`,
    { title: `Chapter ${chapterNumber}`, outline: '' }
  );
}

async function generateChapterOutline(project, plan, chapterNumber) {
  return project.book_type === 'non_fiction'
    ? generateNonFictionChapterOutline(project, plan, chapterNumber)
    : generateFictionChapterOutline(project, plan, chapterNumber);
}

async function generateFictionChapter(project, plan, files, chapter, previousChapter) {
  const sourceContext = sourceSummaries(files, 2500);
  return completeText(
    'You write polished, coherent book chapters from structured planning context. Use markdown headings only where useful.',
    `Write chapter ${chapter.chapter_number} in ${project.target_language || 'English'}.

Project metadata:
Title: ${project.title}
Subtitle: ${project.subtitle || ''}
Author: ${project.author || ''}
Genre: ${project.genre || ''}
Tone: ${project.tone || ''}
Audience: ${project.audience || ''}
Guidance prompt: ${project.guidance_prompt || ''}

Source summaries:
${sourceContext}

Book bible:
${plan.book_bible || ''}

Style guide:
${plan.style_guide || ''}

Continuity notes:
${plan.continuity_notes || ''}

Chapter title:
${chapter.title}

Chapter outline:
${chapter.outline || ''}

Previous chapter summary:
${previousChapter?.summary || 'This is the first chapter.'}

Write a complete chapter. Stay consistent with source material, plan, and continuity.`
  );
}

async function generateNonFictionChapter(project, plan, files, chapter, previousChapter) {
  return completeText(
    'You write clear, structured, factual non-fiction. Never invent facts, quotations, citations, or references. When evidence is absent or uncertain, explicitly write [NEEDS VERIFICATION]. Do not add fictional characters, plot, world-building, or continuity.',
    `Write chapter ${chapter.chapter_number} in ${project.target_language || 'English'}.

Project metadata:
Title: ${project.title}
Subtitle: ${project.subtitle || ''}
Topic: ${project.genre || ''}
Guidance prompt: ${project.guidance_prompt || ''}
Target audience: ${project.audience || plan.target_reader || ''}
Tone: ${project.tone || plan.style_guide || ''}

Uploaded source summaries:
${sourceSummaries(files, 3500) || 'No verified source material is available.'}

Central thesis:
${plan.central_thesis || ''}

Table of contents:
${plan.chapter_list || ''}

Chapter title and outline:
${chapter.title}
${chapter.outline || ''}

Relevant research notes and gaps:
${plan.research_gaps || ''}

Previous chapter summary:
${previousChapter?.summary || 'This is the first chapter.'}

Known claims:
${plan.main_claims || ''}

Factual uncertainty notes:
${plan.fact_checking_notes || ''}

Use an introduction, main argument, supporting sections, examples, practical implications, and a short conclusion where appropriate. Only rely on supplied evidence. Mark claims that need support as [NEEDS VERIFICATION]. Do not fabricate a bibliography.`
  );
}

async function generateChapter(project, plan, files, chapter, previousChapter) {
  return project.book_type === 'non_fiction'
    ? generateNonFictionChapter(project, plan, files, chapter, previousChapter)
    : generateFictionChapter(project, plan, files, chapter, previousChapter);
}

async function summarizeChapter(chapter, project = {}) {
  const instruction = project.book_type === 'non_fiction'
    ? 'Summarize this non-fiction chapter for subsequent writing. Capture the argument, evidence used, conclusions, and unresolved verification issues.'
    : 'Summarize this chapter for future chapter generation. Include plot/argument progress, facts introduced, unresolved threads, and continuity constraints.';
  return completeText(
    'You summarize chapters for continuity in book generation.',
    `${instruction}\n\nTitle: ${chapter.title}\n\nContent:\n${compact(chapter.content)}`
  );
}

async function analyzeNonFictionChapter(project, plan, chapter) {
  return completeJson(
    'You audit non-fiction writing for evidence and factual reliability. Never invent citations or references.',
    `Return JSON with claims_list, references_needed, open_questions, and factual_uncertainty_notes. List only claims actually made. For references_needed, describe the evidence needed without fabricating a source. Use "References needed" when no verified reference is available.

Central thesis: ${plan.central_thesis || ''}
Chapter: ${chapter.title}
Content:
${compact(chapter.content)}`,
    { claims_list: [], references_needed: ['References needed'], open_questions: [], factual_uncertainty_notes: [] }
  );
}

async function reviewNonFictionBook(project, plan, chapters) {
  return completeJson(
    'You perform a consistency and fact-checking review of a non-fiction manuscript. Do not verify facts from memory and never invent citations.',
    `Return JSON with main_claims, research_gaps, and fact_checking_notes. Flag contradictions, unsupported claims, missing evidence, and uncertainty. Label unverified sourcing as "References needed".

Project: ${project.title}
Central thesis: ${plan.central_thesis || ''}
Existing claims: ${plan.main_claims || ''}
Chapter audits:
${chapters.map((chapter) => `Chapter ${chapter.chapter_number}: ${chapter.summary}\nClaims: ${chapter.claims_list}\nReferences: ${chapter.references_needed}\nUncertainty: ${chapter.factual_uncertainty_notes}`).join('\n\n')}`,
    { main_claims: [], research_gaps: [], fact_checking_notes: [] }
  );
}

async function updateContinuity(project, plan, chapter) {
  return completeJson(
    'You maintain a book bible and continuity notes after each generated chapter.',
    `Return JSON with continuity_notes and book_bible.

Project: ${project.title}

Current book bible:
${plan.book_bible || ''}

Current continuity notes:
${plan.continuity_notes || ''}

Latest chapter:
${chapter.title}

Chapter summary:
${chapter.summary || ''}`,
    { continuity_notes: plan.continuity_notes || '', book_bible: plan.book_bible || '' }
  );
}

module.exports = {
  summarizeSourceFile,
  generateBookPlan,
  generateChapterOutline,
  generateChapter,
  summarizeChapter,
  updateContinuity,
  analyzeNonFictionChapter,
  reviewNonFictionBook
};
