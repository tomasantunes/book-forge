const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const { cleanReaderContent } = require('./pdfService');

function xml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xhtmlMarkdown(content) {
  return marked.parse(cleanReaderContent(content))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    .replace(/<(br|hr|img|input)([^>]*?)(?<!\/)>/gi, '<$1$2 />');
}

function document(title, body) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt">
<head><meta charset="utf-8"/><title>${xml(title)}</title><link rel="stylesheet" type="text/css" href="styles/book.css"/></head>
<body>${body}</body></html>`;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosDateTime();
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function exportEpub(project, chapters) {
  const exportDir = path.join(process.cwd(), 'exports');
  fs.mkdirSync(exportDir, { recursive: true });
  const filename = `book-${project.id}-${Date.now()}.epub`;
  const outputPath = path.join(exportDir, filename);
  const identifier = `urn:uuid:${crypto.randomUUID()}`;
  const language = project.target_language?.toLowerCase().startsWith('port') ? 'pt' : 'en';
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const chapterItems = chapters.map((chapter) => ({
    id: `chapter-${chapter.chapter_number}`,
    href: `chapters/chapter-${chapter.chapter_number}.xhtml`,
    title: `Chapter ${chapter.chapter_number}: ${chapter.title}`
  }));
  const entries = [
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OEBPS/styles/book.css', data: 'body{font-family:serif;line-height:1.55;margin:5%;color:#151515}h1,h2,h3{line-height:1.2}a{color:#245b8a}pre,code{font-family:monospace;white-space:pre-wrap}table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;padding:.35em}blockquote{border-left:3px solid #aaa;margin-left:0;padding-left:1em;color:#444}.title-page{text-align:center;margin-top:25%}' },
    { name: 'OEBPS/title.xhtml', data: document(project.title, `<section class="title-page"><h1>${xml(project.title)}</h1>${project.subtitle ? `<h2>${xml(project.subtitle)}</h2>` : ''}${project.author ? `<p>${xml(project.author)}</p>` : ''}</section>`) },
    { name: 'OEBPS/nav.xhtml', data: document('Table of Contents', `<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><h1>Table of Contents</h1><ol>${chapterItems.map((item) => `<li><a href="${item.href}">${xml(item.title)}</a></li>`).join('')}</ol></nav>`) }
  ];
  chapters.forEach((chapter, index) => entries.push({
    name: `OEBPS/${chapterItems[index].href}`,
    data: document(chapter.title, `<section><p>CHAPTER ${chapter.chapter_number}</p><h1>${xml(chapter.title)}</h1>${xhtmlMarkdown(chapter.content)}</section>`)
  }));

  let coverManifest = '';
  let coverMeta = '';
  if (project.cover_image_path) {
    const coverPath = path.resolve(process.cwd(), project.cover_image_path);
    if (fs.existsSync(coverPath)) {
      const extension = path.extname(coverPath).toLowerCase();
      const mediaTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
      const mediaType = mediaTypes[extension];
      if (mediaType) {
        const coverName = `images/cover${extension}`;
        entries.push({ name: `OEBPS/${coverName}`, data: fs.readFileSync(coverPath) });
        coverManifest = `<item id="cover-image" href="${coverName}" media-type="${mediaType}" properties="cover-image"/>`;
        coverMeta = '<meta name="cover" content="cover-image"/>';
      }
    }
  }

  const packageDocument = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${identifier}</dc:identifier><dc:title>${xml(project.title)}</dc:title><dc:language>${language}</dc:language>${project.author ? `<dc:creator>${xml(project.author)}</dc:creator>` : ''}<meta property="dcterms:modified">${modified}</meta>${coverMeta}</metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="title" href="title.xhtml" media-type="application/xhtml+xml"/><item id="css" href="styles/book.css" media-type="text/css"/>${chapterItems.map((item) => `<item id="${item.id}" href="${item.href}" media-type="application/xhtml+xml"/>`).join('')}${coverManifest}</manifest>
<spine><itemref idref="title"/>${chapterItems.map((item) => `<itemref idref="${item.id}"/>`).join('')}</spine></package>`;
  entries.splice(2, 0, { name: 'OEBPS/content.opf', data: packageDocument });
  fs.writeFileSync(outputPath, createZip(entries));
  return path.join('exports', filename);
}

module.exports = { exportEpub };
