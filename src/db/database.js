const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const defaultPath = path.join(__dirname, 'bookforge.sqlite');
const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.cwd(), process.env.DATABASE_PATH)
  : defaultPath;

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

module.exports = db;
