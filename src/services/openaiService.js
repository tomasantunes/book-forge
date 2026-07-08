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

async function summarizeSourceFile(file) {
  return completeText(
    'You summarize uploaded source material for use in long-form book generation.',
    `Summarize this source file for a book-writing AI. Preserve key facts, themes, claims, named entities, chronology, and useful quotes.\n\nFilename: ${file.original_filename}\n\nContent:\n${compact(file.extracted_text)}`
  );
}

async function generateBookPlan(project, files) {
  const sourceSummaries = files.map((file) => `# ${file.original_filename}\n${file.summary || compact(file.extracted_text, 5000)}`).join('\n\n');
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
${sourceSummaries || 'No uploaded files. Use project metadata and guidance only.'}`,
    {}
  );
}

async function generateChapterOutline(project, plan, chapterNumber) {
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

async function generateChapter(project, plan, files, chapter, previousChapter) {
  const sourceContext = files.map((file) => `# ${file.original_filename}\n${file.summary || compact(file.extracted_text, 2500)}`).join('\n\n');
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

async function summarizeChapter(chapter) {
  return completeText(
    'You summarize chapters for continuity in book generation.',
    `Summarize this chapter for future chapter generation. Include plot/argument progress, facts introduced, unresolved threads, and continuity constraints.\n\nTitle: ${chapter.title}\n\nContent:\n${compact(chapter.content)}`
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
  updateContinuity
};
