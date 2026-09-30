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

function wrapWords(text, maxChars) {
  const words = text.trim().split(/\s+/);
  const lines = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }

  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function cardSvg({ title, meta = '', defaultCard = false }) {
  const length = title.length;
  const fontSize = defaultCard ? 78 : length > 58 ? 58 : length > 42 ? 64 : 72;
  const maxChars = defaultCard ? 24 : length > 58 ? 35 : length > 42 ? 31 : 28;
  const lines = wrapWords(title, maxChars);
  const lineHeight = Math.round(fontSize * 1.15);
  const startY = defaultCard ? 255 : 235;
  const lastTitleY = startY + Math.max(0, lines.length - 1) * lineHeight;
  const footerY = defaultCard ? 565 : Math.min(520, lastTitleY + 125);

  const titleLines = lines
    .map((line, index) =>
      `<text x="72" y="${startY + index * lineHeight}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="#111111">${escapeXml(line)}</text>`
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#ffffff"/>
    <circle cx="82" cy="82" r="7" fill="#2563a6"/>
    <text x="102" y="94" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="#111111">Clif Code</text>
    ${meta ? `<text x="1128" y="93" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="600" letter-spacing="0.8" fill="#2563a6">${escapeXml(meta)}</text>` : ''}
    <line x1="72" y1="142" x2="1128" y2="142" stroke="#d8dde3" stroke-width="2"/>
    ${titleLines}
    <text x="72" y="${footerY}" font-family="Arial, Helvetica, sans-serif" font-size="27" fill="#666666">Building things, learning out loud.</text>
    <text x="1128" y="${footerY}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="#7a7a7a">codeclif.github.io</text>
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

async function renderPng(filename, svg) {
  await sharp(Buffer.from(svg))
    .png({ compressionLevel: 9 })
    .toFile(path.join(outputDir, filename));
}

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });

await renderPng(
  'clif-code.png',
  cardSvg({
    title: 'Building things, learning out loud.',
    meta: 'CLIF CODE',
    defaultCard: true
  })
);

const files = (await fs.readdir(postsDir)).filter((file) => file.endsWith('.mdx'));

for (const file of files) {
  const source = await fs.readFile(path.join(postsDir, file), 'utf8');
  const title = frontmatterValue(source, 'title');
  const date = frontmatterValue(source, 'date');
  const type = frontmatterValue(source, 'type');

  if (!title) continue;

  const slug = file.replace(/\.mdx$/, '');
  const meta = [formatDate(date), type?.toUpperCase()].filter(Boolean).join(' · ');

  await renderPng(
    `${slug}.png`,
    cardSvg({ title, meta })
  );
}

console.log(`Generated ${files.length + 1} social preview images in public/og`);
