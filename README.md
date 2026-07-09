# BookForge AI

BookForge AI is a Node.js, Express, SQLite, Bootstrap 5 application for generating long-form fiction and non-fiction books from uploaded `.txt` and `.md` source files, a guidance prompt, and an optional cover image.

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

## Fiction Workflow

1. Upload source files.
2. Generate a book plan. Unsummarized sources are summarized first.
3. Generate the concept, outline, book bible, characters, locations, and style guide.
4. Generate chapters sequentially. Each chapter updates its summary, continuity notes, and book bible.
5. Review, edit, regenerate, or approve chapters.
6. Open the HTML preview and export the generated or approved chapters to PDF.

## Non-fiction Workflow

1. Upload and analyze source files.
2. Generate a central thesis, target reader, table of contents, chapter outlines, source summary, key terms, claims, research gaps, and fact-checking notes.
3. Generate chapters sequentially from the thesis, source summaries, research notes, prior chapter summary, and known uncertainties.
4. Audit every chapter for claims, references needed, open questions, and factual uncertainty.
5. Run a manuscript-level consistency and fact-checking review after sequential generation completes.
6. Review or edit chapters, then preview or export the book. Non-fiction exports add a references-needed section and a research/factual-uncertainty appendix when data is available.

Non-fiction prompts do not request fictional continuity, characters, plot arcs, or world-building. The AI is instructed not to invent facts or citations; unsupported claims are marked as needing verification.

## Main Features

- Project CRUD
- Multiple source file uploads
- Optional cover upload
- Separate OpenAI planning and chapter-generation paths for fiction and non-fiction
- Sequential chapter generation and regeneration
- Chapter editing and approval
- HTML preview
- PDF export with title page, table of contents, chapters, and page numbers
