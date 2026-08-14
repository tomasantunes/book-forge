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

function cleanReaderContent(content) {
  return String(content || '')
    .replace(/(?:\*{1,3}|_{1,3})?\[(?:NEEDS?|REQUIRES?)\s+VERIFICATION\](?:\*{1,3}|_{1,3})?/gi, '')
    .replace(/(?:\*{1,3}|_{1,3})?\[(?:NECESSITA|REQUER)\s+(?:DE\s+)?VERIFICA(?:Ç|C)[AÃ]O\](?:\*{1,3}|_{1,3})?/gi, '')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildPreviewHtml(project, chapters, plan = null) {
  const cover = project.cover_image_path
    ? `<div class="cover-page"><img src="/${project.cover_image_path.replace(/\\/g, '/')}" alt="Cover"></div>`
    : '';
  const toc = chapters.map((chapter) => `<li>Chapter ${chapter.chapter_number}: ${esc(chapter.title)}</li>`).join('');
  const body = chapters.map((chapter) => `
    <section class="chapter">
      <h2>Chapter ${chapter.chapter_number}</h2>
      <h1>${esc(chapter.title)}</h1>
      ${marked.parse(cleanReaderContent(chapter.content))}
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

function registerBookFonts(doc) {
  const fontDir = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
  const fontFiles = {
    regular: path.join(fontDir, 'georgia.ttf'),
    bold: path.join(fontDir, 'georgiab.ttf'),
    italic: path.join(fontDir, 'georgiai.ttf'),
    boldItalic: path.join(fontDir, 'georgiaz.ttf'),
    code: path.join(fontDir, 'consola.ttf')
  };
  if (!Object.values(fontFiles).every(fs.existsSync)) {
    return { regular: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic', boldItalic: 'Times-BoldItalic', code: 'Courier' };
  }
  Object.entries(fontFiles).forEach(([name, file]) => doc.registerFont(`Book-${name}`, file));
  return Object.fromEntries(Object.keys(fontFiles).map((name) => [name, `Book-${name}`]));
}

function addPageNumber(doc, fonts) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    if (index > 0) {
      doc.font(fonts.regular).fontSize(9).fillColor('#777777')
        .text(String(index), 0, doc.page.height - 42, { align: 'center', lineBreak: false });
    }
  }
}

function inlineFragments(tokens, style = {}) {
  const fragments = [];
  for (const token of tokens || []) {
    if (token.type === 'text' || token.type === 'escape') {
      if (token.tokens) fragments.push(...inlineFragments(token.tokens, style));
      else fragments.push({ text: token.text || '', ...style });
    } else if (token.type === 'strong') {
      fragments.push(...inlineFragments(token.tokens, { ...style, bold: true }));
    } else if (token.type === 'em') {
      fragments.push(...inlineFragments(token.tokens, { ...style, italic: true }));
    } else if (token.type === 'codespan') {
      fragments.push({ text: token.text || '', ...style, code: true });
    } else if (token.type === 'link') {
      fragments.push(...inlineFragments(token.tokens, { ...style, link: token.href }));
    } else if (token.type === 'image') {
      fragments.push({ text: token.text || '', ...style, italic: true });
    } else if (token.type === 'br') {
      fragments.push({ text: '\n', ...style });
    } else if (token.type === 'del') {
      fragments.push(...inlineFragments(token.tokens, { ...style, strike: true }));
    } else if (token.text) {
      fragments.push({ text: token.text, ...style });
    }
  }
  return fragments;
}

function renderInline(doc, markdown, fonts, prefix = '') {
  const fragments = [
    ...(prefix ? [{ text: prefix }] : []),
    ...inlineFragments(marked.Lexer.lexInline(String(markdown || '')))
  ].filter((fragment) => fragment.text);
  if (!fragments.length) return;
  fragments.forEach((fragment, index) => {
    const font = fragment.code
      ? fonts.code
      : fragment.bold && fragment.italic
        ? fonts.boldItalic
        : fragment.bold
          ? fonts.bold
          : fragment.italic
            ? fonts.italic
            : fonts.regular;
    doc.font(font).fontSize(fragment.code ? 10 : 11).fillColor(fragment.link ? '#1f5a94' : '#151515').text(fragment.text, {
      continued: index < fragments.length - 1,
      underline: Boolean(fragment.link),
      strike: Boolean(fragment.strike),
      link: fragment.link || undefined,
      lineGap: 3
    });
  });
}

function writeMarkdown(doc, content, fonts) {
  const tokens = marked.lexer(cleanReaderContent(content));
  for (const token of tokens) {
    if (token.type === 'space') continue;
    if (token.type === 'heading') {
      const sizes = { 1: 19, 2: 17, 3: 15, 4: 13, 5: 12, 6: 11 };
      doc.moveDown(0.7).font(fonts.bold).fontSize(sizes[token.depth] || 13).fillColor('#151515').text(token.text).moveDown(0.35);
    } else if (token.type === 'paragraph' || token.type === 'text') {
      renderInline(doc, token.text, fonts);
      doc.moveDown(0.65);
    } else if (token.type === 'list') {
      token.items.forEach((item, index) => {
        renderInline(doc, item.text, fonts, token.ordered ? `${(token.start || 1) + index}. ` : '• ');
        doc.moveDown(0.3);
      });
      doc.moveDown(0.35);
    } else if (token.type === 'blockquote') {
      doc.font(fonts.italic).fillColor('#444444');
      writeMarkdown(doc, token.text, fonts);
      doc.fillColor('#151515').moveDown(0.4);
    } else if (token.type === 'code') {
      doc.font(fonts.code).fontSize(9.5).fillColor('#252525').text(token.text, { lineGap: 2 }).moveDown(0.7);
    } else if (token.type === 'hr') {
      const y = doc.y + 4;
      doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).strokeColor('#bbbbbb').stroke();
      doc.moveDown(1);
    } else if (token.type === 'table') {
      renderInline(doc, token.header.map((cell) => cell.text).join(' | '), fonts);
      token.rows.forEach((row) => renderInline(doc, row.map((cell) => cell.text).join(' | '), fonts));
      doc.moveDown(0.7);
    }
  }
}

function exportPdf(project, chapters, plan = null) {
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
    const fonts = registerBookFonts(doc);

    if (project.cover_image_path) {
      const coverPath = path.resolve(process.cwd(), project.cover_image_path);
      if (fs.existsSync(coverPath)) {
        doc.image(coverPath, 36, 36, { fit: [doc.page.width - 72, doc.page.height - 72], align: 'center', valign: 'center' });
        doc.addPage();
      }
    }

    doc.moveDown(8).font(fonts.bold).fontSize(34).fillColor('#151515').text(project.title, { align: 'center' });
    if (project.subtitle) doc.moveDown().font(fonts.regular).fontSize(19).fillColor('#555555').text(project.subtitle, { align: 'center' });
    if (project.author) doc.moveDown(4).fontSize(15).fillColor('#151515').text(`by ${project.author}`, { align: 'center' });

    doc.addPage().font(fonts.bold).fontSize(24).text('Table of Contents');
    doc.moveDown();
    chapters.forEach((chapter) => {
      doc.font(fonts.regular).fontSize(12).text(`Chapter ${chapter.chapter_number}: ${chapter.title}`, { paragraphGap: 8 });
    });

    chapters.forEach((chapter) => {
      doc.addPage();
      doc.font(fonts.regular).fontSize(11).fillColor('#666666').text(`CHAPTER ${chapter.chapter_number}`, { characterSpacing: 1.5 });
      doc.moveDown(0.5).font(fonts.bold).fontSize(26).fillColor('#151515').text(chapter.title);
      doc.moveDown(1.5);
      writeMarkdown(doc, chapter.content, fonts);
    });

    addPageNumber(doc, fonts);
    doc.end();
  });
}

module.exports = { buildPreviewHtml, exportPdf, cleanReaderContent };
