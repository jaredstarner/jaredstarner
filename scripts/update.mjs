// Regenerates the profile card (assets/card-*.svg) and the latest experiments list in README.md.
// Runs on a schedule from .github/workflows/update.yml; run locally with `node scripts/update.mjs`.
// Writes only files whose content changed, so an unchanged day makes no commit.
import { readFile, writeFile } from 'node:fs/promises';

const CAREER_START = { year: 2013, month: 7 }; // first engineering role
const SANDBOX = { repo: 'jaredstarner/thesandbox.page', dir: 'src/experiments', site: 'https://thesandbox.page', count: 3 };
const LIST_WIDTH = 52; // characters per bullet before it wraps beside the card

const rows = (uptime) => [
  ['Role', 'Director, Software Engineering'],
  ['Uptime', uptime],
  ['Location', 'Columbus, OH & Remote'],
  ['Focus', 'AI harness dev, delivery metrics'],
  ['Tools', 'Claude Code, VS Code, ConEmu, Warp, Bionic'],
  ['Certs', 'Gen AI Leader, Scrum Master'],
  ['Off-hours', 'FAA private pilot'],
];

// GitHub's own code-highlighting colors, so the card reads as part of the page.
const THEMES = {
  dark: { bg: '#151b23', border: '#3d444d', title: '#f0f6fc', key: '#ffa657', value: '#a5d6ff', rule: '#656c76', note: '#7ee787' },
  light: { bg: '#f6f8fa', border: '#d1d9e0', title: '#1f2328', key: '#953800', value: '#0a3069', rule: '#8c959f', note: '#116329' },
};

function uptime(now = new Date()) {
  const months = (now.getUTCFullYear() - CAREER_START.year) * 12 + (now.getUTCMonth() + 1 - CAREER_START.month);
  const y = Math.floor(months / 12);
  const m = months % 12;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return m ? `${plural(y, 'year')}, ${plural(m, 'month')}` : plural(y, 'year');
}

const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Keys sit left, values sit right, and a dotted leader runs under both; a background-colored
// stroke around each label hides the dots behind it, so the layout survives any monospace font.
function card(list, t) {
  const W = 400, pad = 18, top = 30, lh = 20, H = top + lh * (list.length + 1) + 12;
  const halo = `stroke="${t.bg}" stroke-width="10" stroke-linejoin="round" paint-order="stroke"`;
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Consolas, Menlo, 'DejaVu Sans Mono', monospace" font-size="12">`,
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="6" fill="${t.bg}" stroke="${t.border}"/>`,
    `<line x1="${pad}" x2="${W - pad}" y1="${top - 4}" y2="${top - 4}" stroke="${t.rule}"/>`,
    `<text x="${pad}" y="${top}" fill="${t.title}" font-weight="700" ${halo}>jared@starner</text>`,
  ];
  list.forEach(([k, v], i) => {
    const y = top + lh * (i + 1);
    out.push(
      `<line x1="${pad}" x2="${W - pad}" y1="${y - 4}" y2="${y - 4}" stroke="${t.rule}" stroke-dasharray="0 5" stroke-linecap="round" stroke-width="1.4"/>`,
      `<text x="${pad}" y="${y}" fill="${t.key}" ${halo}>${xml(k)}:</text>`,
      `<text x="${W - pad}" y="${y}" fill="${t.value}" text-anchor="end" ${halo}>${xml(v)}</text>`,
    );
  });
  out.push(`<text x="${pad}" y="${top + lh * (list.length + 1) + 2}" fill="${t.note}">Updated daily by GitHub Actions</text>`, '</svg>', '');
  return out.join('\n');
}

async function gh(path) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'jaredstarner-profile' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(path.startsWith('https://') ? path : `https://api.github.com/${path}`, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return res.json();
}

async function experiments() {
  const files = (await gh(`repos/${SANDBOX.repo}/contents/${SANDBOX.dir}`)).filter((f) => f.name.endsWith('.json'));
  const all = await Promise.all(files.map(async (f) => ({ slug: f.name.slice(0, -5), ...(await gh(f.download_url)) })));
  // Newest first; plot numbers only ever grow, so they break same-day ties.
  return all.sort((a, b) => b.date.localeCompare(a.date) || b.plot - a.plot).slice(0, SANDBOX.count);
}

// The site's summaries are full sentences; keep the opening clause and fit it on one line.
function short(title, summary) {
  const budget = LIST_WIDTH - title.length - 2;
  let s = summary.split(/[:;.](?:\s|$)/)[0].trim();
  if (s.length > budget && s.includes(',')) s = s.split(',')[0];
  if (s.length > budget) s = s.slice(0, budget - 1).replace(/\s+\S*$/, '') + '…';
  return /^[A-Z](?=[a-z\s])/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

const md = (s) => s.replace(/([\\`*_[\]<>])/g, '\\$1');

function list(items) {
  return items
    .map((e) => `- [${md(e.title)}](${SANDBOX.site}/${e.slug}/ "${e.summary.replace(/"/g, '&quot;')}"): ${md(short(e.title, e.summary))}`)
    .join('\n');
}

function picture(up) {
  const alt = rows(up).map(([k, v]) => `${k}: ${v}`).join('. ');
  return [
    '<picture>',
    '  <source media="(prefers-color-scheme: dark)" srcset="assets/card-dark.svg">',
    `  <img align="right" width="400" src="assets/card-light.svg" alt="${xml(alt)}">`,
    '</picture>',
  ].join('\n');
}

function between(text, name, body) {
  const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`);
  if (!re.test(text)) throw new Error(`README.md is missing the ${name} markers`);
  return text.replace(re, `$1\n${body}\n$2`);
}

async function write(path, content) {
  const url = new URL(`../${path}`, import.meta.url);
  const old = await readFile(url, 'utf8').catch(() => null);
  if (old === content) return;
  await writeFile(url, content);
  console.log(`updated ${path}`);
}

const up = uptime();
for (const [name, theme] of Object.entries(THEMES)) await write(`assets/card-${name}.svg`, card(rows(up), theme));
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
await write('README.md', between(between(readme, 'card', picture(up)), 'experiments', list(await experiments())));
