const db = require('./database');

function now() {
  return new Date().toISOString();
}

function listProjects() {
  return db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
}

function getProject(id) {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
}

function createProject(data) {
  const stmt = db.prepare(`
    INSERT INTO projects (
      title, subtitle, author, description, guidance_prompt, target_language,
      target_word_count, target_chapter_count, genre, tone, audience, book_type, cover_image_path,
      created_at, updated_at
    ) VALUES (
      @title, @subtitle, @author, @description, @guidance_prompt, @target_language,
      @target_word_count, @target_chapter_count, @genre, @tone, @audience, @book_type, @cover_image_path,
      @created_at, @updated_at
    )
  `);
  const timestamp = now();
  const result = stmt.run({ ...data, created_at: timestamp, updated_at: timestamp });
  return result.lastInsertRowid;
}

function updateProject(id, data) {
  db.prepare(`
    UPDATE projects SET
      title = @title,
      subtitle = @subtitle,
      author = @author,
      description = @description,
      guidance_prompt = @guidance_prompt,
      target_language = @target_language,
      target_word_count = @target_word_count,
      target_chapter_count = @target_chapter_count,
      genre = @genre,
      tone = @tone,
      audience = @audience,
      book_type = @book_type,
      cover_image_path = COALESCE(@cover_image_path, cover_image_path),
      updated_at = @updated_at
    WHERE id = @id
  `).run({ ...data, id, updated_at: now() });
}

function deleteProject(id) {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

function addProjectFile(data) {
  return db.prepare(`
    INSERT INTO project_files (project_id, original_filename, file_path, extracted_text, created_at)
    VALUES (@project_id, @original_filename, @file_path, @extracted_text, @created_at)
  `).run({ ...data, created_at: now() }).lastInsertRowid;
}

function listProjectFiles(projectId) {
  return db.prepare('SELECT * FROM project_files WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
}

function getProjectFile(id) {
  return db.prepare('SELECT * FROM project_files WHERE id = ?').get(id);
}

function updateFileSummary(id, summary) {
  db.prepare('UPDATE project_files SET summary = ? WHERE id = ?').run(summary, id);
}

function deleteProjectFile(projectId, fileId) {
  db.prepare('DELETE FROM project_files WHERE project_id = ? AND id = ?').run(projectId, fileId);
}

function upsertBookPlan(projectId, plan) {
  const existing = getBookPlan(projectId);
  const payload = {
    project_id: projectId,
    concept: serialize(plan.concept || plan.book_concept),
    detailed_outline: serialize(plan.detailed_outline || plan.chapter_outlines),
    chapter_list: serialize(plan.chapter_list || plan.table_of_contents),
    book_bible: serialize(plan.book_bible),
    style_guide: serialize(plan.style_guide || plan.tone_and_style),
    character_location_notes: serialize(plan.character_location_notes),
    continuity_notes: serialize(plan.continuity_notes),
    source_summary: serialize(plan.source_summary || plan.source_material_summary),
    central_thesis: plan.central_thesis || '',
    target_reader: plan.target_reader || '',
    key_terms: serialize(plan.key_terms),
    main_claims: serialize(plan.main_claims),
    research_gaps: serialize(plan.research_gaps),
    fact_checking_notes: serialize(plan.fact_checking_notes),
    updated_at: now()
  };

  if (existing) {
    db.prepare(`
      UPDATE book_plans SET
        concept = @concept,
        detailed_outline = @detailed_outline,
        chapter_list = @chapter_list,
        book_bible = @book_bible,
        style_guide = @style_guide,
        character_location_notes = @character_location_notes,
        continuity_notes = @continuity_notes,
        source_summary = @source_summary,
        central_thesis = @central_thesis,
        target_reader = @target_reader,
        key_terms = @key_terms,
        main_claims = @main_claims,
        research_gaps = @research_gaps,
        fact_checking_notes = @fact_checking_notes,
        updated_at = @updated_at
      WHERE project_id = @project_id
    `).run(payload);
    return existing.id;
  }

  return db.prepare(`
    INSERT INTO book_plans (
      project_id, concept, detailed_outline, chapter_list, book_bible, style_guide,
      character_location_notes, continuity_notes, source_summary, created_at, updated_at
      , central_thesis, target_reader, key_terms, main_claims, research_gaps, fact_checking_notes
    ) VALUES (
      @project_id, @concept, @detailed_outline, @chapter_list, @book_bible, @style_guide,
      @character_location_notes, @continuity_notes, @source_summary, @created_at, @updated_at
      , @central_thesis, @target_reader, @key_terms, @main_claims, @research_gaps, @fact_checking_notes
    )
  `).run({ ...payload, created_at: now() }).lastInsertRowid;
}

function serialize(value) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return JSON.stringify(value, null, 2);
  return value || '';
}

function updateNonFictionReview(projectId, review) {
  db.prepare(`
    UPDATE book_plans SET
      main_claims = @main_claims,
      research_gaps = @research_gaps,
      fact_checking_notes = @fact_checking_notes,
      updated_at = @updated_at
    WHERE project_id = @project_id
  `).run({
    project_id: projectId,
    main_claims: serialize(review.main_claims),
    research_gaps: serialize(review.research_gaps),
    fact_checking_notes: serialize(review.fact_checking_notes),
    updated_at: now()
  });
}

function updateContinuity(projectId, continuityNotes, bookBible) {
  db.prepare(`
    UPDATE book_plans
    SET continuity_notes = ?, book_bible = COALESCE(?, book_bible), updated_at = ?
    WHERE project_id = ?
  `).run(continuityNotes, bookBible || null, now(), projectId);
}

function getBookPlan(projectId) {
  return db.prepare('SELECT * FROM book_plans WHERE project_id = ?').get(projectId);
}

function upsertChapter(projectId, chapter) {
  const payload = {
    project_id: projectId,
    chapter_number: chapter.chapter_number,
    title: chapter.title || `Chapter ${chapter.chapter_number}`,
    outline: chapter.outline || '',
    content: chapter.content || '',
    summary: chapter.summary || '',
    claims_list: serialize(chapter.claims_list),
    references_needed: serialize(chapter.references_needed),
    open_questions: serialize(chapter.open_questions),
    factual_uncertainty_notes: serialize(chapter.factual_uncertainty_notes),
    status: chapter.status || 'draft',
    updated_at: now()
  };

  const existing = getChapterByNumber(projectId, chapter.chapter_number);
  if (existing) {
    db.prepare(`
      UPDATE chapters SET
        title = @title,
        outline = @outline,
        content = @content,
        summary = @summary,
        claims_list = @claims_list,
        references_needed = @references_needed,
        open_questions = @open_questions,
        factual_uncertainty_notes = @factual_uncertainty_notes,
        status = @status,
        updated_at = @updated_at
      WHERE project_id = @project_id AND chapter_number = @chapter_number
    `).run(payload);
    return existing.id;
  }

  return db.prepare(`
    INSERT INTO chapters (
      project_id, chapter_number, title, outline, content, summary, status, created_at, updated_at
      , claims_list, references_needed, open_questions, factual_uncertainty_notes
    ) VALUES (
      @project_id, @chapter_number, @title, @outline, @content, @summary, @status, @created_at, @updated_at
      , @claims_list, @references_needed, @open_questions, @factual_uncertainty_notes
    )
  `).run({ ...payload, created_at: now() }).lastInsertRowid;
}

function listChapters(projectId) {
  return db.prepare('SELECT * FROM chapters WHERE project_id = ? ORDER BY chapter_number ASC').all(projectId);
}

function getChapter(id) {
  return db.prepare('SELECT * FROM chapters WHERE id = ?').get(id);
}

function getChapterByNumber(projectId, chapterNumber) {
  return db.prepare('SELECT * FROM chapters WHERE project_id = ? AND chapter_number = ?').get(projectId, chapterNumber);
}

function getPreviousChapter(projectId, chapterNumber) {
  return db.prepare(`
    SELECT * FROM chapters
    WHERE project_id = ? AND chapter_number < ?
    ORDER BY chapter_number DESC
    LIMIT 1
  `).get(projectId, chapterNumber);
}

function updateChapter(id, data) {
  db.prepare(`
    UPDATE chapters
    SET title = @title, content = @content, status = @status, updated_at = @updated_at
    WHERE id = @id
  `).run({ ...data, id, updated_at: now() });
}

function addLog(projectId, step, status, message, chapterId = null) {
  db.prepare(`
    INSERT INTO generation_logs (project_id, chapter_id, step, status, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(projectId, chapterId, step, status, message || '', now());
}

function listLogs(projectId) {
  return db.prepare(`
    SELECT * FROM generation_logs
    WHERE project_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(projectId);
}

module.exports = {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  addProjectFile,
  listProjectFiles,
  getProjectFile,
  updateFileSummary,
  deleteProjectFile,
  upsertBookPlan,
  updateContinuity,
  updateNonFictionReview,
  getBookPlan,
  upsertChapter,
  listChapters,
  getChapter,
  getChapterByNumber,
  getPreviousChapter,
  updateChapter,
  addLog,
  listLogs
};
