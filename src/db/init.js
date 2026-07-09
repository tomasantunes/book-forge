const db = require('./database');

function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function ensureDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      subtitle TEXT,
      author TEXT,
      description TEXT,
      guidance_prompt TEXT,
      book_type TEXT NOT NULL DEFAULT 'fiction',
      target_language TEXT DEFAULT 'English',
      target_word_count INTEGER DEFAULT 50000,
      target_chapter_count INTEGER DEFAULT 10,
      genre TEXT,
      tone TEXT,
      audience TEXT,
      cover_image_path TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS project_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      original_filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      extracted_text TEXT NOT NULL,
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS book_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL UNIQUE,
      concept TEXT,
      detailed_outline TEXT,
      chapter_list TEXT,
      book_bible TEXT,
      style_guide TEXT,
      character_location_notes TEXT,
      continuity_notes TEXT,
      source_summary TEXT,
      central_thesis TEXT,
      target_reader TEXT,
      key_terms TEXT,
      main_claims TEXT,
      research_gaps TEXT,
      fact_checking_notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      chapter_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      outline TEXT,
      content TEXT,
      summary TEXT,
      claims_list TEXT,
      references_needed TEXT,
      open_questions TEXT,
      factual_uncertainty_notes TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, chapter_number),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS generation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      chapter_id INTEGER,
      step TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
    );
  `);

  addColumnIfMissing('projects', 'book_type', "TEXT NOT NULL DEFAULT 'fiction'");
  addColumnIfMissing('book_plans', 'central_thesis', 'TEXT');
  addColumnIfMissing('book_plans', 'target_reader', 'TEXT');
  addColumnIfMissing('book_plans', 'key_terms', 'TEXT');
  addColumnIfMissing('book_plans', 'main_claims', 'TEXT');
  addColumnIfMissing('book_plans', 'research_gaps', 'TEXT');
  addColumnIfMissing('book_plans', 'fact_checking_notes', 'TEXT');
  addColumnIfMissing('chapters', 'claims_list', 'TEXT');
  addColumnIfMissing('chapters', 'references_needed', 'TEXT');
  addColumnIfMissing('chapters', 'open_questions', 'TEXT');
  addColumnIfMissing('chapters', 'factual_uncertainty_notes', 'TEXT');
}

if (require.main === module) {
  ensureDatabase();
  console.log('Database initialized');
}

module.exports = { ensureDatabase };
