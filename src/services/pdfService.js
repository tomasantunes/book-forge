const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { marked } = require('marked');

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPreviewHtml(project, chapters) {
  const cover = project.cover_image_path
    ? `<div class="cover-page"><img src="/${project.cover_image_path.replace(/\\/g, '/')}" alt="Cover"></div>`
    : '';
  const toc = chapters.map((chapter) => `<li>Chapter ${chapter.chapter_number}: ${esc(chapter.title)}</li>`).join('');
  const body = chapters.map((chapter) => `
    <section class="chapter">
      <h2>Chapter ${chapter.chapter_number}</h2>
      <h1>${esc(chapter.title)}</h1>
      ${marked.parse(chapter.content || '')}
    </section>
  `).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(project.title)}</title>
  <style>
    body { font-family: Georgia, 'Times New Roman', serif; color: #151515; line-height: 1.65; margin: 0; }
    .title-page, .toc, .chapter { max-width: 760px; margin: 0 auto; padding: 64px 48px; }
    .title-page { min-height: 70vh; text-align: center; padding-top: 220px; }
    .title-page h1 { font-size: 44px; margin-bottom: 10px; }
    .title-page h2 { font-size: 24px; font-weight: 400; color: #555; }
    .title-page .author { margin-top: 80px; font-size: 20px; }
    .chapter { border-top: 1px solid #ddd; }
    .chapter h2 { text-transform: uppercase; font-size: 14px; letter-spacing: 2px; color: #666; }
    .cover-page { min-height: 100vh; text-align: center; }
    .cover-page img { max-width: 100%; max-height: 95vh; object-fit: contain; }
  </style></head><body>
  ${cover}
  <section class="title-page"><h1>${esc(project.title)}</h1>${project.subtitle ? `<h2>${esc(project.subtitle)}</h2>` : ''}${project.author ? `<div class="author">by ${esc(project.author)}</div>` : ''}</section>
  <section class="toc"><h1>Table of Contents</h1><ol>${toc}</ol></section>
  ${body}</body></html>`;
}

function addPageNumber(doc) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    if (index > 0) {
      doc.font('Times-Roman').fontSize(9).fillColor('#777777')
        .text(String(index), 0, doc.page.height - 42, { align: 'center' });
    }
  }
}

function writeMarkdownLikeText(doc, content) {
  const lines = String(content || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      doc.moveDown(0.7);
    } else if (line.startsWith('### ')) {
      doc.moveDown().font('Times-Bold').fontSize(15).fillColor('#151515').text(line.slice(4)).moveDown(0.4);
    } else if (line.startsWith('## ')) {
      doc.moveDown().font('Times-Bold').fontSize(17).fillColor('#151515').text(line.slice(3)).moveDown(0.4);
    } else if (line.startsWith('# ')) {
      doc.moveDown().font('Times-Bold').fontSize(19).fillColor('#151515').text(line.slice(2)).moveDown(0.5);
    } else {
      doc.font('Times-Roman').fontSize(11).fillColor('#151515').text(line.replace(/\*\*/g, ''), {
        align: 'justify',
        lineGap: 3,
        paragraphGap: 6
      });
    }
  }
}

function exportPdf(project, chapters) {
  return new Promise((resolve, reject) => {
    const exportDir = path.join(process.cwd(), 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const filename = `book-${project.id}-${Date.now()}.pdf`;
    const outputPath = path.join(exportDir, filename);
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 64, right: 64, bottom: 64, left: 64 },
      bufferPages: true,
      info: { Title: project.title, Author: project.author || '' }
    });
    const stream = fs.createWriteStream(outputPath);
    stream.on('finish', () => resolve(path.join('exports', filename)));
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);

    if (project.cover_image_path) {
      const coverPath = path.resolve(process.cwd(), project.cover_image_path);
      if (fs.existsSync(coverPath)) {
        doc.image(coverPath, 36, 36, { fit: [doc.page.width - 72, doc.page.height - 72], align: 'center', valign: 'center' });
        doc.addPage();
      }
    }

    doc.moveDown(8).font('Times-Bold').fontSize(34).fillColor('#151515').text(project.title, { align: 'center' });
    if (project.subtitle) doc.moveDown().font('Times-Roman').fontSize(19).fillColor('#555555').text(project.subtitle, { align: 'center' });
    if (project.author) doc.moveDown(4).fontSize(15).fillColor('#151515').text(`by ${project.author}`, { align: 'center' });

    doc.addPage().font('Times-Bold').fontSize(24).text('Table of Contents');
    doc.moveDown();
    chapters.forEach((chapter) => {
      doc.font('Times-Roman').fontSize(12).text(`Chapter ${chapter.chapter_number}: ${chapter.title}`, { paragraphGap: 8 });
    });

    chapters.forEach((chapter) => {
      doc.addPage();
      doc.font('Times-Roman').fontSize(11).fillColor('#666666').text(`CHAPTER ${chapter.chapter_number}`, { characterSpacing: 1.5 });
      doc.moveDown(0.5).font('Times-Bold').fontSize(26).fillColor('#151515').text(chapter.title);
      doc.moveDown(1.5);
      writeMarkdownLikeText(doc, chapter.content);
    });

    addPageNumber(doc);
    doc.end();
  });
}

module.exports = { buildPreviewHtml, exportPdf };
