#!/usr/bin/env node
/* Builds the whole site into dist/ from content/people/*.md.

     node build.mjs

   Every page is written out in full HTML, so search engines and AI crawlers read
   every name, date and biography without running any script. Alongside the pages
   it writes sitemap.xml, robots.txt, llms.txt, llms-full.txt, a Markdown copy of
   every person, and open data in data/people.json.

   Portraits: a hand-made relief in reliefs/<slug>.(webp|png|jpg) is always used
   first. Otherwise the photo in photos/ is turned into a plaster relief by
   tools/make-relief.swift (macOS only) and kept in reliefs/auto/. */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const SITE_URL = cfg.url.replace(/\/+$/, '');
const B = cfg.base || '/';
const abs = p => SITE_URL + B + p.replace(/^\//, '');
const today = new Date().toISOString().slice(0, 10);

const exists = f => fs.existsSync(f);
const mtime = f => exists(f) ? fs.statSync(f).mtimeMs : 0;
const write = (rel, data) => {
  const f = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data);
};
const has = cmd => spawnSync('/usr/bin/which', [cmd]).status === 0;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const warn = msg => console.warn('  ! ' + msg);

/* ── reading a person ─────────────────────────────────── */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const yearOf = d => d ? +String(d).slice(0, 4) : null;
const longDate = d => {
  const m = String(d || '').match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (!m) return String(d || '');
  if (m[3]) return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
  if (m[2]) return `${MONTHS[+m[2] - 1]} ${m[1]}`;
  return m[1];
};

/* one name for each section of the index, whatever spelling a file uses */
const CATEGORY_NAMES = {
  media: 'Journalism and media', journalism: 'Journalism and media', 'journalism and media': 'Journalism and media',
  medicine: 'Health and medicine', health: 'Health and medicine', 'health and medicine': 'Health and medicine',
  language: 'Language and script', script: 'Language and script', 'language and script': 'Language and script',
  resistance: 'Resistance movement', 'resistance movement': 'Resistance movement',
  'human rights': 'Human rights', poetry: 'Poetry', literature: 'Literature', politics: 'Politics',
};
const catSlug = c => 'cat-' + c.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function parsePerson(file) {
  const slug = path.basename(file, '.md');
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`${path.basename(file)}: the file must start with a --- header ---`);
  const meta = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim()) continue;
    const i = line.indexOf(':');
    if (i < 0) throw new Error(`${path.basename(file)}: cannot read header line "${line}"`);
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"(.*)"$/, '$1');
  }
  if (!meta.name) throw new Error(`${path.basename(file)}: "name:" is missing`);

  const parts = m[2].split(/^## +/m);
  const sections = {};
  for (const part of parts.slice(1)) {
    const nl = part.indexOf('\n');
    sections[(nl < 0 ? part : part.slice(0, nl)).trim().toLowerCase()] = nl < 0 ? '' : part.slice(nl + 1).trim();
  }
  const list = (s, sep) => (s || '').split(sep).map(x => x.trim()).filter(Boolean);
  const from = yearOf(meta.born), to = yearOf(meta.died);
  const fit = meta.fit ? meta.fit.split(/[\s,]+/).map(Number) : null;
  const relief = {};
  for (const kv of (meta.relief || '').split(/\s+/).filter(Boolean)) {
    const [k, v] = kv.split('=');
    relief[k] = v;
  }

  return {
    slug: meta.slug || slug,
    file,
    name: meta.name,
    native: meta.native || '',
    aka: list(meta.also_known_as, ';'),
    gender: (meta.gender || '').toLowerCase().startsWith('f') ? 'female' : 'male',
    born: meta.born || '', died: meta.died || '',
    from, to,
    years: meta.years || (from && to ? `${from} – ${to}` : from ? `Born ${from}` : ''),
    birthplace: meta.birthplace || '', deathplace: meta.deathplace || '',
    place: meta.place || '',
    role: meta.role || '',
    categories: [...new Set(list(meta.categories, ',').map(c => CATEGORY_NAMES[c.toLowerCase()] || c))],
    epithet: meta.epithet || '',
    photo: meta.photo || '',
    relief,
    fit: fit && { s: fit[0] || 1, dx: fit[1] || 0, dy: fit[2] || 0 },
    tint: meta.tint || '#8E5B45',
    quote: meta.quote || '',
    intro: parts[0].trim(),
    timeline: parseTimeline(sections.timeline || ''),
    biography: sections.biography || '',
    sources: parseSources(sections.sources || ''),
    photos: parsePhotos(sections.photos || ''),
    updated: new Date(mtime(file)).toISOString().slice(0, 10),
  };
}

/* "- 1962 | text", "- * 1962 | a turning point", "- ~ 1962 | circumstance, not deed";
   an indented "> line" under an entry is its afterword */
function parseTimeline(text) {
  const items = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let m;
    if ((m = line.match(/^\s+>\s?(.*)$/)) && items.length) {
      const last = items[items.length - 1];
      last.coda = (last.coda ? last.coda + ' ' : '') + m[1].trim();
    } else if ((m = line.match(/^-\s+(\*|~)?\s*([^|]+?)\s*\|\s*(.+)$/))) {
      items.push({ kind: m[1] === '*' ? 'major' : m[1] === '~' ? 'life' : '', year: m[2], text: m[3].trim() });
    } else if (items.length) {
      items[items.length - 1].text += ' ' + line.trim();
    }
  }
  return items;
}

/* "- A book or article", "- Title | https://…", or "- [Title](https://…)" */
function parseSources(text) {
  return text.split('\n').map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean).map(l => {
    let m = l.match(/^\[(.+?)\]\((https?:\/\/[^)]+)\)\s*$/);
    if (m) return { label: m[1], url: m[2] };
    m = l.match(/^(.+?)\s*\|\s*(https?:\/\/\S+)\s*$/);
    if (m) return { label: m[1], url: m[2] };
    m = l.match(/^(https?:\/\/\S+)$/);
    if (m) return { label: m[1].replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''), url: m[1] };
    return { label: l, url: '' };
  });
}

/* "- abdul-hadi-2.jpg | caption | credit or source": real photographs, kept in photos/ */
function parsePhotos(text) {
  return text.split('\n').map(l => l.trim()).filter(l => l.startsWith('-')).map(l => {
    const [file, caption = '', credit = ''] = l.replace(/^-\s*/, '').split('|').map(x => x.trim());
    return { file, caption, credit };
  }).filter(x => x.file);
}

/* a small Markdown: paragraphs, "- " lists, "> " quotes, **bold**, *italic*, [links](url) */
function inline(s) {
  return esc(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, t, u) => `<a href="${u}" rel="noopener">${t}</a>`)
    /* a link to another page of the archive: [E. Kader Marakan](/people/marakan/) */
    .replace(/\[([^\]]+)\]\(\/([^)\s]*)\)/g, (_, t, u) => `<a href="${B}${u}">${t}</a>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
}
function markdown(md) {
  return md.split(/\n{2,}/).map(block => {
    const lines = block.split('\n');
    if (lines.every(l => /^\s*-\s+/.test(l))) return `<ul>${lines.map(l => `<li>${inline(l.replace(/^\s*-\s+/, ''))}</li>`).join('')}</ul>`;
    if (lines.every(l => /^>\s?/.test(l))) return `<blockquote>${inline(lines.map(l => l.replace(/^>\s?/, '')).join(' '))}</blockquote>`;
    return `<p>${inline(lines.join(' '))}</p>`;
  }).join('\n');
}
/* site links made whole, for readers outside the site: Markdown copies, open data */
const absLinks = md => String(md || '').replace(/\]\(\/(?!\/)/g, '](' + SITE_URL + B);
const plain = md => md.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*>]/g, '').replace(/^\s*-\s+/gm, '').replace(/\s+/g, ' ').trim();

/* ── portraits ────────────────────────────────────────── */

const RELIEF_SRC = path.join(ROOT, 'tools', 'make-relief.swift');
const RELIEF_BIN = path.join(ROOT, 'tools', '.bin', 'make-relief');
let reliefTool;
function reliefToolPath() {
  if (reliefTool !== undefined) return reliefTool;
  reliefTool = null;
  if (process.platform !== 'darwin' || !has('swiftc')) return null;
  if (mtime(RELIEF_BIN) < mtime(RELIEF_SRC)) {
    console.log('  compiling the relief tool…');
    fs.mkdirSync(path.dirname(RELIEF_BIN), { recursive: true });
    const r = spawnSync('swiftc', ['-O', RELIEF_SRC, '-o', RELIEF_BIN], { stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.status !== 0) { warn('could not compile tools/make-relief.swift:\n' + r.stderr); return null; }
  }
  return (reliefTool = RELIEF_BIN);
}

const CWEBP = has('cwebp');
function webp(src, out, size) {
  if (exists(out) && mtime(out) >= mtime(src)) return true;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (!CWEBP) return false;
  const r = spawnSync('cwebp', ['-quiet', '-q', '82', '-resize', String(size), String(size), src, '-o', out]);
  return r.status === 0;
}

/* Returns { master, kind }: kind "made" (hand-made relief), "auto" (generated), "photo" (fallback) or "none" */
function portraitFor(p) {
  for (const ext of ['webp', 'png', 'jpg', 'jpeg']) {
    const f = path.join(ROOT, 'reliefs', `${p.slug}.${ext}`);
    if (exists(f)) return { master: f, kind: 'made' };
  }
  const photo = p.photo && path.join(ROOT, 'photos', p.photo);
  if (!photo || !exists(photo)) {
    if (p.photo) warn(`${p.slug}: photo "${p.photo}" not found in photos/`);
    return { master: null, kind: 'none' };
  }
  const auto = path.join(ROOT, 'reliefs', 'auto', `${p.slug}.webp`);
  const stampFile = path.join(ROOT, 'reliefs', 'auto', `${p.slug}.json`);
  const stamp = JSON.stringify({ photo: p.photo, size: fs.statSync(photo).size, relief: p.relief, tool: mtime(RELIEF_SRC) });
  const fresh = exists(auto) && exists(stampFile) && fs.readFileSync(stampFile, 'utf8') === stamp;
  if (fresh) return { master: auto, kind: 'auto' };
  const tool = reliefToolPath();
  if (tool && CWEBP) {
    const tmp = path.join(ROOT, 'reliefs', 'auto', `.${p.slug}.png`);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    const args = [photo, tmp];
    for (const [k, v] of Object.entries(p.relief)) args.push('--' + k, v);
    const r = spawnSync(tool, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.status === 0 && spawnSync('cwebp', ['-quiet', '-q', '86', tmp, '-o', auto]).status === 0) {
      fs.rmSync(tmp, { force: true });
      fs.writeFileSync(stampFile, stamp);
      console.log(`  carved a relief for ${p.name}`);
      return { master: auto, kind: 'auto' };
    }
    fs.rmSync(tmp, { force: true });
    warn(`${p.slug}: could not carve a relief (${(r.stderr || '').toString().trim()}); showing the photo`);
  } else if (exists(auto)) {
    return { master: auto, kind: 'auto' };   /* an older relief is better than none */
  }
  return { master: photo, kind: 'photo' };
}

/* ── load ─────────────────────────────────────────────── */

console.log('Building', cfg.name);
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const files = fs.readdirSync(path.join(ROOT, 'content', 'people')).filter(f => f.endsWith('.md') && !f.startsWith('_'));
const people = files.map(f => parsePerson(path.join(ROOT, 'content', 'people', f)))
  .sort((a, b) => a.name.localeCompare(b.name));
const seen = new Set();
for (const p of people) {
  if (seen.has(p.slug)) throw new Error(`two people share the slug "${p.slug}"`);
  seen.add(p.slug);
}
for (const p of people) {
  const text = [p.intro, ...p.timeline.map(t => t.text + ' ' + (t.coda || '')), p.biography].join(' ');
  for (const [, slug] of text.matchAll(/\]\(\/people\/([^/)]+)\/?\)/g)) if (!seen.has(slug)) warn(`${p.slug}: links to /people/${slug}/, but no one on the wall has that address`);
}

for (const p of people) {
  const { master, kind } = portraitFor(p);
  p.kind = kind;
  /* how much of the tile the portrait fills: the wall leaves bare plaster around
     every face. Carved-from-photo busts are cut wider, so they sit a little smaller. */
  p.fit ||= { s: kind === 'auto' ? 0.75 : 0.8, dx: 0, dy: kind === 'auto' ? -1 : 0 };
  if (!master) {
    p.img = p.img512 = B + 'assets/no-portrait.svg';
    continue;
  }
  const big = `reliefs/${p.slug}.webp`, small = `reliefs/${p.slug}-512.webp`;
  const okBig = webp(master, path.join(DIST, big), 1024);
  const okSmall = webp(master, path.join(DIST, small), 512);
  if (okBig && okSmall) {
    p.img = B + big; p.img512 = B + small; p.masterOut = path.join(DIST, big);
  } else {
    const ext = path.extname(master);
    fs.copyFileSync(master, path.join(DIST, `reliefs/${p.slug}${ext}`));
    p.img = p.img512 = B + `reliefs/${p.slug}${ext}`; p.masterOut = path.join(DIST, `reliefs/${p.slug}${ext}`);
  }
}

/* ── real photographs ─────────────────────────────────── */

/* width and height straight from the file, so every print reserves its space before it loads */
function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') { const n = b.readUInt32LE(21); return { w: (n & 0x3fff) + 1, h: ((n >> 14) & 0x3fff) + 1 }; }
    if (kind === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}
/* a copy no larger than `max` on its longer side, never blown up past the original */
function photoCopy(src, rel, size, max) {
  const out = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const k = Math.min(1, max / Math.max(size.w, size.h));
  const w = Math.round(size.w * k), h = Math.round(size.h * k);
  if (CWEBP && spawnSync('cwebp', ['-quiet', '-q', '84', ...(k < 1 ? ['-resize', String(w), String(h)] : []), src, '-o', out]).status === 0) return { url: B + rel, w, h };
  return null;
}

for (const p of people) {
  /* no list given: the photo the relief was carved from is still a real photograph of them */
  const list = p.photos.length ? p.photos : (p.photo ? [{ file: p.photo, caption: '', credit: '' }] : []);
  p.prints = [];
  for (const ph of list) {
    const src = path.join(ROOT, 'photos', ph.file);
    if (!exists(src)) { warn(`${p.slug}: photo "${ph.file}" not found in photos/`); continue; }
    const size = imageSize(src);
    const base = ph.file.replace(/\.[^.]+$/, '');
    let big = size && photoCopy(src, `photos/${base}.webp`, size, 1600);
    let small = size && photoCopy(src, `photos/${base}-480.webp`, size, 480);
    if (!big || !small) {
      fs.mkdirSync(path.join(DIST, 'photos'), { recursive: true });
      fs.copyFileSync(src, path.join(DIST, 'photos', ph.file));
      big = small = { url: B + 'photos/' + ph.file, w: size?.w || 0, h: size?.h || 0 };
    }
    p.prints.push({ ...ph, big, small, alt: ph.caption || `Photograph of ${p.name}` });
  }
}

/* ── shared pieces ────────────────────────────────────── */

const pron = p => p.gender === 'female' ? { he: 'she', his: 'her', His: 'Her' } : { he: 'he', his: 'his', His: 'His' };
const personPath = p => `people/${p.slug}/`;
const homeTitle = `${cfg.name} — ${cfg.tagline}`;
const pageTitle = p => `${p.name}${p.years ? ` (${p.years.replace(/\s*–\s*/, '–')})` : ''}${p.role ? ` — ${p.role}` : ''} | ${cfg.name}`;
const clip = (s, n = 158) => { s = plain(s); return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…'; };
const sub = p => p.native || p.role;
const hash = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 8);

/* The two ways to see the archive: the wall of portraits (the default) and the index of
   every name. Set like the original's language toggle: the view you are in engraved dark,
   the other faint. On a phone, where the header shows icons only, one icon crosses over. */
const viewSwitch = current => `<span class="hbtn views" role="group" aria-label="View">${ICON.wall}<a href="${B}"${current === 'wall' ? ' class="on" aria-current="page"' : ''}>Wall</a><i>·</i><a href="${B}people/"${current === 'index' ? ' class="on" aria-current="page"' : ''}>Index</a></span>
    <a class="hbtn views-icon" href="${current === 'wall' ? `${B}people/` : B}" aria-label="${current === 'wall' ? 'Index view: every name' : 'Wall view'}">${current === 'wall' ? ICON.list : ICON.wall}</a>`;

const ICON = {
  carve: '<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M249.92,113.4,182.47,45.49a94.12,94.12,0,0,0-133,.06L35.68,59.78a6,6,0,0,0,8.63,8.35L58,54A82,82,0,0,1,78.55,39l49,49L30.09,185.4a14,14,0,0,0,0,19.81L50.78,225.9a14,14,0,0,0,19.8,0L168,128.46l33.42,33.42a14,14,0,0,0,19.8,0l28.68-28.69A14,14,0,0,0,249.92,113.4ZM62.1,217.41a2,2,0,0,1-2.83,0L38.58,196.72a2,2,0,0,1,0-2.83L108,124.46,131.51,148ZM163.76,115.73,140,139.49,116.48,116l23.76-23.76a6,6,0,0,0,0-8.49L90.54,34A82.07,82.07,0,0,1,174,54l45.62,45.93L188,131.49l-15.76-15.76A6,6,0,0,0,163.76,115.73Zm77.66,9-28.69,28.7a2,2,0,0,1-2.83,0L196.49,140l31.56-31.57,13.37,13.46A2,2,0,0,1,241.42,124.7Z"/></svg>',
  ask: '<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M170,112a6,6,0,0,1-6,6H96a6,6,0,0,1,0-12h68A6,6,0,0,1,170,112Zm-6,26H96a6,6,0,0,0,0,12h68a6,6,0,0,0,0-12Zm66-14a98.11,98.11,0,0,1-98,98H48a14,14,0,0,1-14-14V124a98,98,0,0,1,196,0Zm-12,0a86,86,0,0,0-172,0v84a2,2,0,0,0,2,2h84A86.1,86.1,0,0,0,218,124Z"/></svg>',
  wall: '<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M216,42H40A14,14,0,0,0,26,56V200a14,14,0,0,0,14,14H216a14,14,0,0,0,14-14V56A14,14,0,0,0,216,42Zm2,14v66H134V54h82A2,2,0,0,1,218,56ZM40,54h82v68H38V56A2,2,0,0,1,40,54ZM38,200V134h84v68H40A2,2,0,0,1,38,200Zm178,2H134V134h84v66A2,2,0,0,1,216,202Z"/></svg>',
  list: '<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M88,64a6,6,0,0,1,6-6H216a6,6,0,0,1,0,12H94A6,6,0,0,1,88,64Zm128,58H94a6,6,0,0,0,0,12H216a6,6,0,0,0,0-12Zm0,64H94a6,6,0,0,0,0,12H216a6,6,0,0,0,0-12ZM52,54a10,10,0,1,0,10,10A10,10,0,0,0,52,54Zm0,64a10,10,0,1,0,10,10A10,10,0,0,0,52,118Zm0,64a10,10,0,1,0,10,10A10,10,0,0,0,52,182Z"/></svg>',
  x: '<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M204.24,195.76a6,6,0,1,1-8.48,8.48L128,136.49,60.24,204.24a6,6,0,0,1-8.48-8.48L119.51,128,51.76,60.24a6,6,0,0,1,8.48-8.48L128,119.51l67.76-67.75a6,6,0,0,1,8.48,8.48L136.49,128Z"/></svg>',
  send: '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/></svg>',
};

/* ── the profile: what the panel shows for one person ──── */

const timeHTML = (d, label) => /^\d{4}(-\d{2}){0,2}$/.test(d) ? `<time datetime="${d}">${esc(label)}</time>` : esc(label);
function eraHTML(p) {
  let years = esc(p.years);
  if (!p.native && p.from && p.to && p.years === `${p.from} – ${p.to}`) years = `${timeHTML(p.born, String(p.from))} – ${timeHTML(p.died, String(p.to))}`;
  return [years, esc(p.place)].filter(Boolean).join('  ·  ');
}

function profileHTML(p) {
  const P = pron(p);
  const tl = p.timeline.map(t => `
    <li class="tl-item${t.kind ? ' ' + t.kind : ''}">
      <div class="tl-year">${/^\d{4}$/.test(t.year) ? `<time datetime="${t.year}">${t.year}</time>` : esc(t.year)}</div>
      <div class="tl-text">${inline(t.text)}${t.coda ? `<span class="tl-coda">${inline(t.coda)}</span>` : ''}</div>
    </li>`).join('');
  const src = p.sources.length ? `
    <div class="tl-src">
      <span class="src-lbl">${p.sources.length > 1 ? 'Sources' : 'Source'}</span>
      <div class="src-list">${p.sources.map(s => s.url
        ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`
        : `<cite>${esc(s.label)}</cite>`).join('')}</div>
    </div>` : '';
  return `<div class="r-rule"><i></i><span>From the wall</span><i></i></div>
<h1 class="r-name">${esc(p.name)}${sub(p) ? `<span class="n-sub">${esc(sub(p))}</span>` : ''}</h1>
<p class="r-era">${eraHTML(p)}</p>
${p.aka.length ? `<p class="r-aka">Also known as ${p.aka.map(esc).join(', ')}</p>` : ''}
${p.categories.length ? `<p class="r-cats">${p.categories.map(c => `<a href="${B}people/#${catSlug(c)}">${esc(c)}</a>`).join('<i></i>')}</p>` : ''}
<p class="r-intro">${inline(p.intro)}</p>
${tl ? `<div class="r-rule"><i></i><span>What ${P.he} did</span><i></i></div>
<ol class="tl">${tl}
</ol>` : ''}${src}
${p.prints.length ? `<div class="r-rule"><i></i><span>${p.prints.length > 1 ? 'Photographs' : 'Photograph'}</span><i></i></div>
<div class="r-photos${p.prints.length === 1 ? ' one' : ''}">
${p.prints.map((ph, i) => `  <figure class="print">
    <a href="${ph.big.url}" data-photo="${i}" data-w="${ph.big.w}" data-h="${ph.big.h}" data-caption="${esc(ph.caption)}" data-credit="${esc(ph.credit)}" aria-label="Enlarge: ${esc(ph.alt)}">
      <img src="${ph.small.url}" srcset="${ph.small.url} ${ph.small.w}w, ${ph.big.url} ${ph.big.w}w" sizes="(max-width: 768px) 44vw, 300px" width="${ph.small.w}" height="${ph.small.h}" alt="${esc(ph.alt)}" loading="lazy" decoding="async">
    </a>
    ${ph.caption || ph.credit ? `<figcaption>${esc(ph.caption)}${ph.credit ? `<span class="credit">${esc(ph.credit)}</span>` : ''}</figcaption>` : ''}
  </figure>`).join('\n')}
</div>` : ''}
${p.quote ? `<div class="r-rule"><i></i><span>${P.His} words</span><i></i></div>
<blockquote class="r-quote"><p>“${esc(p.quote)}”</p></blockquote>` : ''}
${p.biography ? `<div class="r-rule"><i></i><span>${P.His} story</span><i></i></div>
<section class="r-story" aria-label="Biography of ${esc(p.name)}">
${p.epithet ? `<h2>${esc(p.epithet)}</h2>\n` : ''}${markdown(p.biography)}
</section>
` : ''}
<div class="r-actions">
${p.biography ? `  <button class="btn-talk" type="button" data-story data-open="Read ${P.his} full story" data-close="Fold ${P.his} story away">Read ${P.his} full story</button>
` : ''}  <button class="btn-talk" type="button" data-correct aria-expanded="false">Submit a correction</button>
</div>
<form class="r-correct" data-person="${esc(p.name)}" hidden novalidate>
  <div class="msg tip">Something here wrong or missing, or a better photo?<br>Tell us, and we will check it against the sources.</div>
  <div class="field"><label for="cor-text">What did we get wrong?</label><textarea id="cor-text" name="correction" rows="5"></textarea><span class="field-error"></span></div>
  <div class="field">
    <label for="cor-photo">A photo of ${p.gender === 'female' ? 'her' : 'him'}, or a better one (optional)</label>
    <label class="drop" for="cor-photo">
      <input id="cor-photo" type="file" accept="image/*">
      <img class="drop-preview" alt="" hidden>
      <span class="drop-text">Choose a photo, or drop one here</span>
      <button class="drop-clear" type="button" hidden>Remove</button>
    </label>
    <span class="field-error"></span>
  </div>
  <div class="field"><label for="cor-source">A source for the correction or photo (optional)</label><input id="cor-source" name="source" type="url" inputmode="url"></div>
  <div class="field"><label for="cor-email">Your email (optional)</label><input id="cor-email" name="email" type="email" inputmode="email" autocomplete="email"><span class="field-error"></span></div>
  <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
  <button class="btn-talk" type="submit">Send correction</button>
  <div class="msg tip form-note" role="status" hidden></div>
</form>`;
}

/* ── pages ────────────────────────────────────────────── */

/* a new number every build, so a browser never keeps last week's search index or profiles */
const BUILD = Date.now().toString(36);
const CSS_V = hash(path.join(ROOT, 'src', 'style.css'));
const JS_V = hash(path.join(ROOT, 'src', 'app.js'));
const json = o => JSON.stringify(o).replace(/</g, '\\u003c');

function layout({ title, description, canonical, image, imageAlt, type = 'website', ld, bodyClass = '', head = '', body }) {
  return `<!doctype html>
<html lang="${cfg.language || 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<meta name="theme-color" content="${cfg.themeColor}">
<meta property="og:site_name" content="${esc(cfg.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="${type}">
<meta property="og:locale" content="en_US">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(imageAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${image}">
<meta name="twitter:image:alt" content="${esc(imageAlt)}">
<link rel="icon" href="${B}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${B}apple-touch-icon.png">
<link rel="sitemap" type="application/xml" href="${B}sitemap.xml">
<link rel="alternate" type="application/json" title="Open data" href="${B}data/people.json">
${head}<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400;1,500&amp;display=swap" rel="stylesheet">
<link rel="stylesheet" href="${B}assets/style.css?v=${CSS_V}">
<script>document.documentElement.classList.add('js')</script>
<script type="application/ld+json">${json(ld)}</script>
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
${body}
</body>
</html>
`;
}

const wallData = people.map(p => ({
  slug: p.slug, name: p.name, sub: sub(p), years: p.years, gender: p.gender,
  img: p.img, img512: p.img512, fit: p.fit, tint: p.tint, photo: p.kind === 'photo', title: pageTitle(p),
}));

function staticTile(p) {
  return `<a class="tile" href="${B}${personPath(p)}"><span class="glow"></span><img class="relief${p.kind === 'photo' ? ' photo' : ''}" src="${p.img512}" alt="${esc(p.name)}" width="512" height="512" loading="lazy"><span class="tile-name"><span class="n-main">${esc(p.name)}</span>${sub(p) ? `<span class="n-sub">${esc(sub(p))}</span>` : ''}</span></a>`;
}

function wallPage(p) {
  const isPerson = !!p;
  const focus = p || people[0];
  const ff = focus.fit;
  return `<header id="header">
  ${isPerson ? `<a class="title" href="${B}">${esc(cfg.name)}</a>` : `<h1 class="title">${esc(cfg.name)}</h1>`}
  <nav class="hgroup" aria-label="Wall">
    ${viewSwitch('wall')}
    <button class="hbtn" id="btn-nominate" type="button" aria-label="Carve a name">${ICON.carve}<span class="label">Carve a name</span></button>
    <button class="hbtn" id="btn-ask" type="button" aria-label="Search the wall">${ICON.ask}<span class="label">Search the wall</span></button>
  </nav>
</header>

<main id="wall" aria-label="The wall of portraits">
  <p class="sr-only">${esc(cfg.description)} Choose a portrait to read about a life.</p>
  <nav class="wall-static" aria-label="Everyone on the wall">
    ${people.map(staticTile).join('\n    ')}
  </nav>
</main>
<div id="grain"></div>
<div id="veil"${isPerson ? ' class="show"' : ''}></div>
<figure id="focus"${isPerson ? ' class="show"' : ''}>
  <div class="glow"></div>
  <img class="relief${focus.kind === 'photo' ? ' photo' : ''}" src="${isPerson ? focus.img : ''}" alt="${isPerson ? esc(`${focus.name}, portrait in plaster relief`) : ''}" draggable="false" style="transform:translate(${ff.dx}%,${ff.dy}%) scale(${ff.s})"${isPerson ? ' width="1024" height="1024" fetchpriority="high"' : ''}>
  <div class="tint-img" style="background:radial-gradient(ellipse 60% 60% at 50% 48%, ${focus.tint} 0%, transparent 75%)"></div>
  <figcaption>${isPerson ? esc(focus.name) : ''}</figcaption>
</figure>
<div id="grain-focus"></div>

<aside id="panel"${isPerson ? ' class="open"' : ''} aria-label="${isPerson ? esc(p.name) : 'Details'}">
  <div id="panel-head">
    <span id="panel-label">${isPerson ? 'From the wall' : esc(cfg.name)}</span>
    <button id="panel-x" type="button" aria-label="Close">${ICON.x}</button>
  </div>
  <div id="panel-body">
    <div class="mode" id="mode-search">
      <div id="conv-log" aria-live="polite">
        <div class="msg tip">A name, a place, a year, or a question.<br>There is no wrong way to begin.</div>
      </div>
    </div>
    <article class="mode${isPerson ? ' active' : ''}" id="mode-profile">${isPerson ? profileHTML(p) : ''}</article>
    <div class="mode" id="mode-nominate">
      <div class="msg tip">Know a Rohingya life<br>that belongs on this wall?<br>Tell us about them.</div>
      <form id="nom-form" novalidate>
      <div class="field"><label for="nom-name">Their name</label><input id="nom-name" name="name" autocomplete="off"><span class="field-error"></span></div>
      <div class="field"><label for="nom-desc">What they did</label><textarea id="nom-desc" name="desc" rows="5"></textarea></div>
      <div class="field">
        <label for="nom-photo">A photo of them (optional)</label>
        <label class="drop" for="nom-photo">
          <input id="nom-photo" type="file" accept="image/*">
          <img class="drop-preview" alt="" hidden>
          <span class="drop-text">Choose a photo, or drop one here</span>
          <button class="drop-clear" type="button" hidden>Remove</button>
        </label>
        <span class="field-error"></span>
      </div>
      <div class="field"><label for="nom-source">A link about them (optional)</label><input id="nom-source" name="source" type="url" inputmode="url"></div>
      <div class="field"><label for="nom-email">Your email (optional)</label><input id="nom-email" name="email" type="email" inputmode="email" autocomplete="email"><span class="field-error"></span></div>
      <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <button class="btn-talk" id="nom-submit" type="submit">Submit</button>
      <div class="msg tip form-note" id="nom-thanks" role="status" hidden></div>
      </form>
    </div>
  </div>
  <div id="panel-foot">
    <ul id="suggest" role="listbox" aria-label="Names on the wall" hidden></ul>
    <div id="ask-box">
      <label class="sr-only" for="story-input">Search the wall</label>
      <textarea id="story-input" rows="2" placeholder="A name, a village, a year, a question…" aria-controls="suggest" aria-autocomplete="list"></textarea>
      <button id="send-btn" type="button" title="Send" aria-label="Send">${ICON.send}</button>
    </div>
  </div>
  <a class="panel-credit" href="${B}people/">The full index · ${people.length} names</a>
</aside>
<div id="panel-haze"></div>
<div id="lightbox" role="dialog" aria-modal="true" aria-label="Photograph" hidden>
  <figure>
    <div class="lb-frame"><img alt=""></div>
    <figcaption><span class="lb-caption"></span><span class="credit lb-credit"></span><span class="lb-count"></span></figcaption>
  </figure>
  <button class="lb-btn lb-prev" type="button" aria-label="Previous photograph"><svg viewBox="0 0 256 256" aria-hidden="true"><path d="M164.24,203.76a6,6,0,1,1-8.48,8.48l-80-80a6,6,0,0,1,0-8.48l80-80a6,6,0,0,1,8.48,8.48L88.49,128Z"/></svg></button>
  <button class="lb-btn lb-next" type="button" aria-label="Next photograph"><svg viewBox="0 0 256 256" aria-hidden="true"><path d="M180.24,132.24l-80,80a6,6,0,0,1-8.48-8.48L167.51,128,91.76,52.24a6,6,0,0,1,8.48-8.48l80,80A6,6,0,0,1,180.24,132.24Z"/></svg></button>
  <button class="lb-btn lb-close" type="button" aria-label="Close">${ICON.x}</button>
</div>

<noscript><style>.r-story{max-height:none;-webkit-mask-image:none;mask-image:none}[data-story],#panel-foot,.hgroup{display:none}</style></noscript>
<script>window.RFP = ${json({ site: { name: cfg.name, base: B, homeTitle, v: BUILD }, people: wallData, page: { slug: p ? p.slug : null }, submit: { endpoint: cfg.submissions?.endpoint || '', to: cfg.submissions?.to || '' } })}</script>
<script src="${B}assets/app.js?v=${JS_V}" defer></script>`;
}

const WEBSITE_ID = SITE_URL + B + '#website';
const websiteLD = {
  '@type': 'WebSite', '@id': WEBSITE_ID, url: SITE_URL + B, name: cfg.name, description: cfg.description, inLanguage: cfg.language || 'en',
  potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: SITE_URL + B + '?q={search_term_string}' }, 'query-input': 'required name=search_term_string' },
};
function personLD(p) {
  const place = name => name ? { '@type': 'Place', name } : undefined;
  return {
    '@type': 'Person', '@id': abs(personPath(p)) + '#person',
    name: p.name,
    ...(p.aka.length ? { alternateName: p.aka } : {}),
    description: plain(p.intro),
    ...(p.role ? { jobTitle: p.role } : {}),
    gender: p.gender === 'female' ? 'Female' : 'Male',
    ...(p.born ? { birthDate: p.born } : {}),
    ...(p.died ? { deathDate: p.died } : {}),
    ...(p.birthplace ? { birthPlace: place(p.birthplace) } : {}),
    ...(p.deathplace ? { deathPlace: place(p.deathplace) } : {}),
    ...(p.categories.length ? { knowsAbout: p.categories } : {}),
    ...(p.masterOut || p.prints.length ? { image: [
      ...p.prints.map(ph => ({ '@type': 'ImageObject', contentUrl: SITE_URL + ph.big.url, width: ph.big.w, height: ph.big.h,
        caption: ph.caption || `Photograph of ${p.name}`, ...(ph.credit ? { creditText: ph.credit } : {}) })),
      ...(p.masterOut ? [{ '@type': 'ImageObject', contentUrl: abs(p.img), caption: `${p.name}, portrait in plaster relief` }] : []),
    ] } : {}),
    url: abs(personPath(p)),
    ...(p.sources.some(s => s.url) ? { sameAs: p.sources.filter(s => s.url).map(s => s.url) } : {}),
  };
}

/* ── social cards ─────────────────────────────────────── */

const cards = [];
const cardOut = rel => path.join(DIST, rel);
const ogRel = p => `og/${p.slug}.jpg`;
const withRelief = people.filter(p => p.masterOut);
if (has('python3') && withRelief.length) {
  for (const p of withRelief) cards.push({ out: cardOut(ogRel(p)), images: [p.masterOut], title: p.name, subtitle: [p.years, p.role].filter(Boolean).join(' · '), kicker: cfg.name });
  cards.push({ out: cardOut('og/home.jpg'), images: withRelief.slice(0, 4).map(p => p.masterOut), title: cfg.name, subtitle: cfg.tagline, kicker: '' });
  const spec = path.join(DIST, '.cards.json');
  fs.writeFileSync(spec, JSON.stringify(cards));
  const r = spawnSync('python3', ['-I', path.join(ROOT, 'tools', 'make-og.py'), spec], { stdio: ['ignore', 'ignore', 'pipe'] });
  fs.rmSync(spec, { force: true });
  if (r.status !== 0) { warn('social cards were not made (python3 with Pillow is needed):\n' + r.stderr); cards.length = 0; }
}
const ogFor = p => cards.length && p.masterOut ? abs(ogRel(p)) : p.masterOut ? abs(p.img) : abs('og/home.jpg');
const homeOG = cards.length ? abs('og/home.jpg') : (withRelief[0] ? abs(withRelief[0].img) : '');

/* ── write: the wall ──────────────────────────────────── */

write('index.html', layout({
  title: homeTitle,
  description: cfg.description,
  canonical: SITE_URL + B,
  image: homeOG,
  imageAlt: `Portraits carved in plaster relief on the ${cfg.name} wall`,
  ld: {
    '@context': 'https://schema.org',
    '@graph': [
      websiteLD,
      {
        '@type': 'CollectionPage', '@id': SITE_URL + B + '#wall', url: SITE_URL + B, name: cfg.name, description: cfg.description, isPartOf: { '@id': WEBSITE_ID },
        mainEntity: { '@type': 'ItemList', numberOfItems: people.length, itemListElement: people.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(personPath(p)), name: p.name })) },
      },
    ],
  },
  body: wallPage(null),
}));

/* ── write: one page per person ───────────────────────── */

for (const p of people) {
  const url = abs(personPath(p));
  write(`${personPath(p)}index.html`, layout({
    title: pageTitle(p),
    description: clip(`${p.name}${p.years ? ` (${p.years})` : ''}${p.role ? `, ${p.role.toLowerCase()}` : ''}. ${p.intro}`),
    canonical: url,
    image: ogFor(p),
    imageAlt: `${p.name}, portrait in plaster relief`,
    type: 'profile',
    head: `<link rel="alternate" type="text/markdown" title="${esc(p.name)} (Markdown)" href="${B}${personPath(p)}index.md">\n`,
    ld: {
      '@context': 'https://schema.org',
      '@graph': [
        websiteLD,
        {
          '@type': 'ProfilePage', '@id': url, url, name: pageTitle(p), isPartOf: { '@id': WEBSITE_ID },
          dateModified: p.updated, inLanguage: cfg.language || 'en',
          mainEntity: { '@id': url + '#person' },
          breadcrumb: { '@type': 'BreadcrumbList', itemListElement: [
            { '@type': 'ListItem', position: 1, name: cfg.name, item: SITE_URL + B },
            { '@type': 'ListItem', position: 2, name: 'People', item: abs('people/') },
            { '@type': 'ListItem', position: 3, name: p.name, item: url },
          ] },
        },
        personLD(p),
      ],
    },
    body: wallPage(p),
  }));
  write(`${personPath(p)}profile.html`, profileHTML(p));
  write(`${personPath(p)}index.md`, personMarkdown(p));
}

/* the Markdown copy: links to other people made whole, so they work outside the site */
function personMarkdown(p) { return absLinks(personMarkdownText(p)); }
function personMarkdownText(p) {
  const P = pron(p);
  const facts = [
    p.aka.length && `- Also known as: ${p.aka.join('; ')}`,
    p.role && `- Known for: ${p.role}`,
    (p.born || p.birthplace) && `- Born: ${[p.born && longDate(p.born), p.birthplace].filter(Boolean).join(', ')}`,
    (p.died || p.deathplace) && `- Died: ${[p.died && longDate(p.died), p.deathplace].filter(Boolean).join(', ')}`,
    p.place && `- Place: ${p.place}`,
    p.categories.length && `- Fields: ${p.categories.join(', ')}`,
    `- Page: ${abs(personPath(p))}`,
  ].filter(Boolean).join('\n');
  return `# ${p.name}${p.years ? ` (${p.years})` : ''}

> ${[p.role, p.place].filter(Boolean).join(' · ')}

${facts}

## Summary

${p.intro}
${p.timeline.length ? `
## What ${P.he} did

${p.timeline.map(t => `- **${t.year}** — ${t.text}${t.coda ? ` (${t.coda})` : ''}`).join('\n')}
` : ''}${p.quote ? `
## ${P.His} words

> “${p.quote}”
` : ''}${p.biography ? `
## Biography${p.epithet ? `: ${p.epithet}` : ''}

${p.biography}
` : ''}${p.sources.length ? `
## Sources

${p.sources.map(s => `- ${s.url ? `[${s.label}](${s.url})` : s.label}`).join('\n')}
` : ''}${p.prints.length ? `
## Photographs

${p.prints.map(ph => `- ![${ph.alt}](${SITE_URL + ph.big.url})${ph.caption ? ` ${ph.caption}` : ''}${ph.credit ? ` (${ph.credit})` : ''}`).join('\n')}
` : ''}
---
From ${cfg.name}, ${abs(personPath(p))} (updated ${p.updated})
`;
}

/* ── write: the index of every name ───────────────────── */

/* a life belongs in every section it shaped: B. A. Jafar under Resistance and Politics both */
const byCategory = {};
for (const p of people) for (const c of (p.categories.length ? p.categories : ['Other'])) (byCategory[c] ||= []).push(p);
const sections = Object.keys(byCategory).sort((a, b) => a.localeCompare(b));
write('people/index.html', layout({
  title: `Every name on the wall — ${people.length} Rohingya lives | ${cfg.name}`,
  description: `The full index of ${cfg.name}: ${people.length} Rohingya leaders, writers, poets, scholars and public servants, with dates, places and biographies.`,
  canonical: abs('people/'),
  image: homeOG,
  imageAlt: `Portraits carved in plaster relief on the ${cfg.name} wall`,
  bodyClass: 'index-page',
  ld: {
    '@context': 'https://schema.org',
    '@graph': [websiteLD, {
      '@type': 'CollectionPage', '@id': abs('people/'), url: abs('people/'), name: `Every name on the wall`, isPartOf: { '@id': WEBSITE_ID },
      mainEntity: { '@type': 'ItemList', numberOfItems: people.length, itemListElement: people.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(personPath(p)), name: p.name })) },
    }],
  },
  body: `<header id="header">
  <a class="title" href="${B}">${esc(cfg.name)}</a>
  <nav class="hgroup" aria-label="Wall">
    ${viewSwitch('index')}
    <a class="hbtn" href="${B}?carve">${ICON.carve}<span class="label">Carve a name</span></a>
    <a class="hbtn" href="${B}?ask">${ICON.ask}<span class="label">Search the wall</span></a>
  </nav>
</header>
<div id="grain"></div>
<main class="index">
  <div class="r-rule"><i></i><span>The full index</span><i></i></div>
  <h1>Every name on the wall</h1>
  <p class="lede">${esc(cfg.description)}</p>
  <nav class="index-nav" aria-label="Sections">
    ${sections.map(cat => `<a href="#${catSlug(cat)}">${esc(cat)}<span>${byCategory[cat].length}</span></a>`).join('\n    ')}
  </nav>
  ${sections.map(cat => `
  <section id="${catSlug(cat)}" aria-label="${esc(cat)}">
    <div class="r-rule index-cat"><i></i><span>${esc(cat)}</span><i></i></div>
    <ul class="index-list">
      ${byCategory[cat].map(p => `<li><a href="${B}${personPath(p)}">
        <span class="thumb"><img class="relief${p.kind === 'photo' ? ' photo' : ''}" src="${p.img512}" alt="" width="96" height="96" loading="lazy"></span>
        <span><span class="i-name">${esc(p.name)}</span><span class="i-meta">${esc([p.years, p.role].filter(Boolean).join(' · '))}</span></span>
      </a></li>`).join('\n      ')}
    </ul>
  </section>`).join('')}
  <p class="index-foot">Open data: <a href="${B}data/people.json">people.json</a> · For AI assistants: <a href="${B}llms.txt">llms.txt</a> and <a href="${B}llms-full.txt">llms-full.txt</a></p>
</main>`,
}));

/* ── write: 404 ───────────────────────────────────────── */

write('404.html', layout({
  title: `Not on the wall | ${cfg.name}`,
  description: cfg.description,
  canonical: SITE_URL + B,
  image: homeOG, imageAlt: cfg.name,
  bodyClass: 'index-page',
  head: '<meta name="robots" content="noindex">\n',
  ld: { '@context': 'https://schema.org', ...websiteLD },
  body: `<div id="grain"></div>
<main class="index">
  <div class="r-rule"><i></i><span>${esc(cfg.name)}</span><i></i></div>
  <h1>This name is not carved here</h1>
  <p class="lede">The page you were looking for is not on the wall. Return to <a href="${B}">the wall</a>, or see <a href="${B}people/">every name</a>.</p>
</main>`,
}));

/* ── write: data for search, readers and machines ─────── */

write('data/search.json', JSON.stringify(people.map(p => ({
  slug: p.slug, name: p.name, aka: p.aka, role: p.role, categories: p.categories, epithet: p.epithet,
  place: p.place, birthplace: p.birthplace, deathplace: p.deathplace, from: p.from, to: p.to,
  born: p.born, died: p.died, quote: p.quote,
  intro: plain(p.intro),
  timeline: p.timeline.map(t => `${t.year}: ${plain(t.text)}${t.coda ? ' ' + plain(t.coda) : ''}`).join(' '),
  bio: plain([p.biography, ...p.prints.map(ph => ph.caption)].join(' ')),
}))));

write('data/people.json', JSON.stringify({
  name: cfg.name, url: SITE_URL + B, description: cfg.description, updated: today,
  ...(cfg.license ? { license: cfg.license } : {}),
  count: people.length,
  people: people.map(p => ({
    slug: p.slug, url: abs(personPath(p)), markdown: abs(personPath(p) + 'index.md'),
    name: p.name, alsoKnownAs: p.aka, native: p.native || undefined, gender: p.gender,
    born: p.born || undefined, died: p.died || undefined, years: p.years,
    birthplace: p.birthplace || undefined, deathplace: p.deathplace || undefined, place: p.place,
    role: p.role, categories: p.categories, epithet: p.epithet || undefined,
    summary: plain(p.intro), quote: p.quote || undefined,
    timeline: p.timeline.map(t => ({ year: t.year, text: absLinks(t.text), ...(t.coda ? { note: t.coda } : {}), ...(t.kind ? { kind: t.kind } : {}) })),
    biography: absLinks(p.biography), sources: p.sources,
    image: p.masterOut ? abs(p.img) : undefined,
    photos: p.prints.map(ph => ({ url: SITE_URL + ph.big.url, width: ph.big.w, height: ph.big.h, caption: ph.caption || undefined, credit: ph.credit || undefined })),
    updated: p.updated,
  })),
}, null, 2));

write('llms.txt', `# ${cfg.name}

> ${cfg.description}

${cfg.name} is an open archive of the lives of famous Rohingya people. Every person has a page with a short summary, a dated timeline of what they did, sources where known, and the full biography. Each page also has a plain Markdown copy (linked below), and the whole archive is available as JSON. You are welcome to read, cite and link to it; please name ${cfg.name} and link the person's page.

## People

${people.map(p => `- [${p.name}](${abs(personPath(p) + 'index.md')}): ${[p.role, p.years, p.place].filter(Boolean).join(', ')}. ${clip(p.intro, 180)}`).join('\n')}

## Data

- [Every biography in one file](${abs('llms-full.txt')}): all people, full text, Markdown
- [Open data](${abs('data/people.json')}): all people as structured JSON
- [Index of every name](${abs('people/')})
- [Sitemap](${abs('sitemap.xml')})
`);

write('llms-full.txt', `# ${cfg.name} — every biography

> ${cfg.description}

${people.length} people. Generated ${today} from ${SITE_URL + B}

${people.map(p => personMarkdown(p)).join('\n\n')}`);

/* AI assistants and search engines are named one by one so that a default
   "block AI" rule elsewhere on the host never shuts them out by accident */
const BOTS = ['Googlebot', 'Bingbot', 'DuckDuckBot', 'Applebot', 'Applebot-Extended', 'Google-Extended', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'anthropic-ai', 'PerplexityBot', 'Perplexity-User', 'CCBot', 'Meta-ExternalAgent',
  'Amazonbot', 'cohere-ai', 'MistralAI-User', 'DuckAssistBot', 'YouBot', 'Bytespider'];
write('robots.txt', `# ${cfg.name} is an open archive. Search engines and AI assistants are welcome.
User-agent: *
Allow: /

${BOTS.map(b => `User-agent: ${b}\nAllow: /`).join('\n\n')}

Sitemap: ${abs('sitemap.xml')}
`);

write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url><loc>${SITE_URL + B}</loc><lastmod>${today}</lastmod></url>
  <url><loc>${abs('people/')}</loc><lastmod>${today}</lastmod></url>
${people.map(p => `  <url><loc>${abs(personPath(p))}</loc><lastmod>${p.updated}</lastmod>${p.prints.map(ph => `<image:image><image:loc>${SITE_URL + ph.big.url}</image:loc></image:image>`).join('')}${p.masterOut ? `<image:image><image:loc>${abs(p.img)}</image:loc></image:image>` : ''}</url>`).join('\n')}
</urlset>
`);

/* ── write: assets ────────────────────────────────────── */

fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'src', 'style.css'), path.join(DIST, 'assets', 'style.css'));
fs.copyFileSync(path.join(ROOT, 'src', 'app.js'), path.join(DIST, 'assets', 'app.js'));
for (const f of fs.readdirSync(path.join(ROOT, 'src', 'static'))) fs.copyFileSync(path.join(ROOT, 'src', 'static', f), path.join(DIST, f === 'no-portrait.svg' ? 'assets/' + f : f));
if (cfg.submissions?.to) {
  write('api/submit.js', fs.readFileSync(path.join(ROOT, 'src', 'api', 'submit.js'), 'utf8').replace('__SUBMIT_TO__', cfg.submissions.to));
  write('package.json', JSON.stringify({ private: true, type: 'module', engines: { node: '>=20' } }, null, 2));
}
write('vercel.json', JSON.stringify({
  trailingSlash: true,
  headers: [
    { source: '/reliefs/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=604800' }] },
    { source: '/og/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=604800' }] },
    { source: '/(.*).md', headers: [{ key: 'Content-Type', value: 'text/markdown; charset=utf-8' }] },
    { source: '/llms(.*).txt', headers: [{ key: 'Content-Type', value: 'text/plain; charset=utf-8' }] },
  ],
}, null, 2));

const kinds = people.reduce((a, p) => (a[p.kind] = (a[p.kind] || 0) + 1, a), {});
console.log(`Done: ${people.length} people → dist/  (portraits: ${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')})`);
if (SITE_URL.includes('rohingyafamouspeople.org')) console.log('  note: "url" in site.config.json is still the placeholder domain; set it before going live.');
