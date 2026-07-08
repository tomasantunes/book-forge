# BookForge AI

BookForge AI is a Node.js, Express, SQLite, Bootstrap 5 application for generating long-form books from uploaded `.txt` and `.md` source files, a guidance prompt, and an optional cover image.

## Setup

Node.js 22 or newer is required because the app uses Node's built-in SQLite module.

```bash
cd bookforge-ai
npm install
cp .env.example .env
```

Edit `.env` and set `OPENAI_API_KEY`.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Notes

- Uploaded files are stored in `uploads/`.
- Exported PDFs are stored in `exports/`.
- SQLite data is stored at `src/db/bookforge.sqlite` by default.
- The app validates file types and upload size.
- Book generation is incremental: file summaries, plan, chapter outlines, chapters, summaries, and continuity notes are saved as generation progresses.
- AI generation requires a valid OpenAI API key. Project CRUD, chapter editing, preview, and PDF export remain local.

## Generation Flow

1. Upload source files.
2. Generate a book plan. Unsummarized sources are summarized first.
3. Generate chapters. Missing outlines are created before the first chapter.
4. Each chapter is saved, summarized, and used to update continuity notes and the book bible.
5. Review, edit, regenerate, or approve chapters.
6. Open the HTML preview and export the generated or approved chapters to PDF.

## Main Features

- Project CRUD
- Multiple source file uploads
- Optional cover upload
- OpenAI-powered book plan generation
- Sequential chapter generation and regeneration
- Chapter editing and approval
- HTML preview
- PDF export with title page, table of contents, chapters, and page numbers
