import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const postsDir = path.join(root, 'src/pages/posts');
const outputDir = path.join(root, 'public/og');

const escapeXml = (value = '') =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

function frontmatterValue(source, key) {
  const frontmatter = source.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? '';
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (!match) return '';
  return match[1].trim().replace(/^["']|["']$/g, '');
}

function greedyLines(words, maxChars) {
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Wrap into as few lines as fit, then even them out so a short word like
// "II" never sits alone. Text beyond maxLines ends with an ellipsis.
function wrapWords(text, maxChars, maxLines = 3) {
  const words = text.trim().split(/\s+/);
  let lines = greedyLines(words, maxChars);
  for (let width = Math.ceil(text.length / lines.length); width < maxChars; width++) {
    const balanced = greedyLines(words, width);
    if (balanced.length === lines.length) {
      lines = balanced;
      break;
    }
  }
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > maxChars - 1 || /[,.;:]$/.test(last)) last = last.replace(/\s*\S+$/, '');
  kept[maxLines - 1] = `${last.replace(/[,.;:]$/, '')}…`;
  return kept;
}

const brandMark = path.join(root, 'src/assets/brand/clif-code-wordmark-vertical.png');
const MARK_HEIGHT = 486;
// [max title length, font size, max characters per line] keeps titles clear of the brush mark.
const TEXT_WIDTH_CHARS = { title: [[24, 76, 18], [48, 64, 21], [Infinity, 56, 24]], description: 48 };

function cardSvg({ title, description = '', meta = '' }) {
  const [, fontSize, maxChars] = TEXT_WIDTH_CHARS.title.find(([limit]) => title.length <= limit);
  const titleLines = wrapWords(title, maxChars);
  const titleLineHeight = Math.round(fontSize * 1.12);
  const titleTop = meta ? 196 : 150;
  // A three-line title leaves room for only two lines of description above the footer rule.
  const descriptionLines = description ? wrapWords(description, TEXT_WIDTH_CHARS.description, titleLines.length >= 3 ? 2 : 3) : [];
  const descriptionTop = titleTop + (titleLines.length - 1) * titleLineHeight + 70;

  const text = (x, y, size, weight, fill, value, extra = '') =>
    `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" ${extra}>${escapeXml(value)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#ffffff"/>
    ${meta ? text(72, 104, 24, 700, '#2563a6', meta, 'letter-spacing="1"') : ''}
    ${titleLines.map((line, i) => text(72, titleTop + i * titleLineHeight, fontSize, 700, '#111111', line)).join('')}
    ${descriptionLines.map((line, i) => text(72, descriptionTop + i * 40, 28, 400, '#555555', line)).join('')}
    <line x1="72" y1="522" x2="840" y2="522" stroke="#e2e5e9" stroke-width="2"/>
    ${text(72, 568, 26, 700, '#111111', 'clifcode.eth')}
    ${text(250, 568, 26, 400, '#666666', 'Building things, learning out loud.')}
  </svg>`;
}

function formatDate(raw) {
  if (!raw) return '';
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date).toUpperCase();
}

// The vertical brush wordmark sits down the right edge of every card.
const mark = await sharp(brandMark).resize({ height: MARK_HEIGHT }).toBuffer({ resolveWithObject: true });

async function renderPng(filename, svg) {
  await sharp(Buffer.from(svg))
    .composite([{ input: mark.data, left: 1128 - mark.info.width, top: Math.round((630 - MARK_HEIGHT) / 2) }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(outputDir, filename));
}

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });

await renderPng(
  'clif-code.png',
  cardSvg({
    title: 'Building things, learning out loud.',
    description: 'Notes, research and diary entries from Clif, a builder in Ghana.'
  })
);

const files = (await fs.readdir(postsDir)).filter((file) => file.endsWith('.mdx'));

for (const file of files) {
  const source = await fs.readFile(path.join(postsDir, file), 'utf8');
  const title = frontmatterValue(source, 'title');
  const date = frontmatterValue(source, 'date');
  const type = frontmatterValue(source, 'type');
  const description = frontmatterValue(source, 'description').replaceAll('\\"', '"');

  if (!title) continue;

  const slug = file.replace(/\.mdx$/, '');
  const meta = [formatDate(date), type?.toUpperCase()].filter(Boolean).join(' · ');

  await renderPng(
    `${slug}.png`,
    cardSvg({ title, description, meta })
  );
}

console.log(`Generated ${files.length + 1} social preview images in public/og`);
