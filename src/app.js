/* Rohingya Famous People — the wall.
   Every page arrives fully written by the build (the wall's names, and on a
   person's page their whole profile), so search engines and readers without
   scripts get everything. This script only brings the wall to life. */
(() => {
'use strict';

const { site, people, page, submit: SUBMIT } = window.RFP;
const BASE = site.base;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const personURL = p => `${BASE}people/${p.slug}/`;
const bySlug = s => people.findIndex(p => p.slug === s);
const his = p => p.gender === 'female' ? 'her' : 'his';

const UI = {
  ask:       'Search the wall',
  fromWall:  'From the wall',
  nominate:  'Carve a name',
  keeper:    'Keeper of the wall',
  readStory: p => `Read ${his(p)} story`,
  found:     n => n === 1 ? 'One life on the wall answers to that.' : `${n} lives on the wall answer to that.`,
  more:      n => `…and ${n} more. Ask again with another word to narrow the wall.`,
  notFound:  'No one by that name is on the wall yet — perhaps we have not reached that story. Would you like to carve the name here?',
  nomNameErr:'Please enter a valid name',
  partial:   'Nothing on the wall answers every word of that. These come closest.',
  didYouMean: n => `No one by that name is on the wall. Did you mean ${n}?`,
  everyone:  n => `All ${n} lives on the wall, from A to Z.`,
  shareName: (n, name) => `${counted(n)} lives on the wall bear the name ${name}.`,
  alsoIn:    (name, n) => `${name} also appears in the ${n === 1 ? 'story of one more life' : `stories of ${n} more lives`}.`,
  emailErr:  'That email address does not look right',
  textErr:   'Please tell us what we got wrong, or add a photo',
  photoErr:  'Please choose an image file',
  photoBig:  'That photo is too large; please choose a smaller one',
  corThanks: 'Thank you. We will check it against the sources and correct the page.',
  sendFail:  'It could not be sent from here just now.',
  byEmail:   'Send it by email instead',
  attach:    'Please attach the photo to the email.',
  nomThanks: 'Thank you. The story has been received and we will read it with care.',
};

/* ── Infinite wall ───────────────────────────────────── */
const wall = $('#wall');
/* tiles grow with the screen: roughly four across on a desktop, however wide it is */
const PHONE_TILE = 220;
const tileSize = () => innerWidth <= 768
  ? PHONE_TILE
  : Math.round(Math.max(360, Math.min(innerWidth / 3.6, innerHeight / 2.4)));
let TILE = tileSize();
const coarse = matchMedia('(pointer: coarse)');
const SEAM = 1;
let offX = 0, offY = 0;
const pool = new Map();
const personAt = (r, c) => { const n = people.length; return ((r * 4 + c) % n + n) % n; };

function tileInner(p) {
  const f = p.fit;
  return `<span class="glow"></span>
    <img class="relief${p.photo ? ' photo' : ''}" src="${p.img512}" srcset="${p.img512} 512w, ${p.img} 1024w" sizes="${TILE}px"
         alt="${esc(p.name)}" draggable="false" loading="lazy" decoding="async"
         style="transform:translate(${f.dx}%,${f.dy}%) scale(${f.s})"
         onload="this.classList.add('loaded')" onerror="this.style.display='none'">
    <span class="tile-name"><span class="n-main">${esc(p.name)}</span>${p.sub ? `<span class="n-sub">${esc(p.sub)}</span>` : ''}</span>`;
}

/* The tiles all sit on one plane, and only the plane moves: one transform a frame,
   handled by the graphics card, instead of re-placing every tile on every touch. */
const plane = document.createElement('div');
plane.className = 'plane';
wall.appendChild(plane);
const grain = $('#grain');
const GRAIN_PERIOD = 700;   /* the coarse plaster mottle repeats every 700px; the fine tooth hides any seam */
let range = '';

/* put the right tiles on the plane for where the wall now is; cheap when nothing changed */
function fill() {
  const vw = innerWidth, vh = innerHeight;
  const c0 = Math.floor(-offX / TILE) - 1, r0 = Math.floor(-offY / TILE) - 1;
  const c1 = Math.ceil((vw - offX) / TILE) + 1, r1 = Math.ceil((vh - offY) / TILE) + 1;
  const key = `${c0},${r0},${c1},${r1}`;
  if (key === range) return;
  range = key;
  const needed = new Set();
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const k = r + ',' + c;
      needed.add(k);
      if (pool.has(k)) continue;
      const i = personAt(r, c), p = people[i];
      /* a tile is a real link: crawlers follow it, Ctrl/Cmd-click opens a tab,
         and an ordinary click is caught below and opens her or him in place */
      const el = document.createElement('a');
      el.className = 'tile';
      el.href = personURL(p);
      el.draggable = false;
      el.style.width = el.style.height = (TILE - SEAM) + 'px';
      el.style.transform = `translate(${c * TILE}px, ${r * TILE}px)`;
      el.dataset.i = i;
      el.setAttribute('aria-label', p.sub ? `${p.name}, ${p.sub}` : p.name);
      el.innerHTML = tileInner(p);
      if (matchState) applyMatch(el);
      plane.appendChild(el);
      pool.set(k, el);
    }
  }
  for (const [k, el] of pool) if (!needed.has(k)) { el.remove(); pool.delete(k); }
}

/* move the wall to where it now is, at once */
function place() {
  plane.style.transform = `translate3d(${offX}px, ${offY}px, 0)`;
  /* the grain belongs to the wall, so it travels with it: slid, never repainted */
  const gx = ((offX % GRAIN_PERIOD) + GRAIN_PERIOD) % GRAIN_PERIOD - GRAIN_PERIOD;
  const gy = ((offY % GRAIN_PERIOD) + GRAIN_PERIOD) % GRAIN_PERIOD - GRAIN_PERIOD;
  grain.style.transform = `translate3d(${gx}px, ${gy}px, 0)`;
  fill();
}
/* many pointer events can arrive in one frame; the wall moves once per frame */
let frame = 0;
function render() {
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; place(); });
}

/* Momentum: let go mid-swipe and the wall glides on, slowing as plaster would under a
   hand, never stopping dead. A touch while it glides catches it, and is not a tap. */
let glide = 0;
const FRICTION = 0.9965;   /* the speed kept per millisecond: a firm flick runs on for about a second */
function stopGlide() { if (glide) { cancelAnimationFrame(glide); glide = 0; return true; } return false; }
function startGlide(vx, vy) {
  stopGlide();
  const max = 4.5;   /* px per ms: fast, but the wall never flies off out of reach */
  const sp = Math.hypot(vx, vy);
  if (sp > max) { vx *= max / sp; vy *= max / sp; }
  let last = performance.now();
  const step = now => {
    const dt = Math.min(40, now - last);
    last = now;
    offX += vx * dt; offY += vy * dt;
    const k = Math.pow(FRICTION, dt);
    vx *= k; vy *= k;
    place();
    glide = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(step) : 0;
  };
  glide = requestAnimationFrame(step);
}

let dragging = false, sx = 0, sy = 0, moved = 0, caught = false, trail = [];
wall.addEventListener('pointerdown', e => {
  /* middle-click and Ctrl/Cmd-click stay with the browser: a new tab */
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  caught = stopGlide();
  dragging = true; moved = 0;
  sx = e.clientX; sy = e.clientY;
  trail = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];
  wall.classList.add('dragging');
  wall.setPointerCapture(e.pointerId);
});
wall.addEventListener('pointermove', e => {
  if (!dragging) return;
  const dx = e.clientX - sx, dy = e.clientY - sy;
  moved += Math.abs(dx) + Math.abs(dy);
  offX += dx; offY += dy;
  sx = e.clientX; sy = e.clientY;
  /* the last tenth of a second of movement is what sets the glide */
  trail.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
  while (trail.length > 2 && e.timeStamp - trail[0].t > 100) trail.shift();
  render();
});
const endDrag = e => {
  if (!dragging) return;
  dragging = false;
  wall.classList.remove('dragging');
  const tap = e.type === 'pointerup' && moved < (e.pointerType === 'touch' ? 10 : 6);
  if (tap && !caught) {
    /* pointer capture retargets the event to the wall, so find the tile under the cursor */
    const tile = document.elementFromPoint(e.clientX, e.clientY)?.closest('.tile');
    if (tile) openPerson(+tile.dataset.i, tile);
    return;
  }
  const first = trail[0], last = trail[trail.length - 1];
  const dt = last && first ? last.t - first.t : 0;
  /* a finger that came to rest before lifting means: stay here */
  if (e.type === 'pointerup' && dt > 0 && e.timeStamp - last.t < 60) {
    const vx = (last.x - first.x) / dt, vy = (last.y - first.y) / dt;
    if (Math.hypot(vx, vy) > 0.12) startGlide(vx, vy);
  }
};
wall.addEventListener('pointerup', endDrag);
wall.addEventListener('pointercancel', endDrag);
wall.addEventListener('click', e => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  /* Enter on a focused tile arrives as a click with no pointer behind it */
  const tile = e.target.closest?.('.tile');
  if (tile && e.detail === 0) openPerson(+tile.dataset.i, tile);
});
wall.addEventListener('keydown', e => {
  if (e.key !== ' ') return;
  const tile = e.target.closest?.('.tile');
  if (!tile) return;
  e.preventDefault();
  openPerson(+tile.dataset.i, tile);
});
/* read ahead: a hovered portrait's profile is fetched before the click */
wall.addEventListener('pointerover', e => {
  const tile = e.target.closest?.('.tile');
  if (tile && !dragging) loadProfile(people[+tile.dataset.i].slug).catch(() => {});
});

/* a trackpad brings its own momentum, so the wheel moves the wall as it is told */
addEventListener('wheel', e => {
  if (panel.contains(e.target) || focusEl.classList.contains('show') || !lb.hidden) return;
  stopGlide();
  offX -= e.deltaX; offY -= e.deltaY;
  render();
}, { passive: true });

/* ── Sunlight: a soft warm pool drifting after the cursor ─ */
let resizeSun = null;
if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
  const sun = document.createElement('div');
  sun.id = 'sunlight';
  resizeSun = () => {
    const R = TILE * 0.66;
    sun.style.width = sun.style.height = (R * 2) + 'px';
    sun.style.margin = `-${R}px 0 0 -${R}px`;
  };
  resizeSun();
  /* a flat plateau to 55%, then a soft penumbra: a sun patch, not a spotlight */
  sun.style.background = `radial-gradient(circle closest-side,
    rgba(255,224,172,0.056) 0%, rgba(255,224,172,0.056) 55%, rgba(255,224,172,0.048) 66%,
    rgba(255,224,172,0.028) 78%, rgba(255,224,172,0.008) 89%, rgba(255,224,172,0) 100%)`;
  document.body.appendChild(sun);

  let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y, on = 0, target = 0, looping = false;
  wall.addEventListener('pointerenter', e => { x = tx = e.clientX; y = ty = e.clientY; });
  wall.addEventListener('pointermove', e => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    tx = e.clientX; ty = e.clientY; target = 1;
    if (!looping) { looping = true; requestAnimationFrame(step); }
  });
  wall.addEventListener('pointerleave', () => { target = 0; });
  function step() {
    x += (tx - x) * 0.10; y += (ty - y) * 0.10;
    on += (target - on) * 0.07;
    sun.style.transform = `translate(${x}px, ${y}px)`;
    sun.style.opacity = on.toFixed(3);
    if (target || on > 0.005) requestAnimationFrame(step);
    else { looping = false; sun.style.opacity = 0; }
  }
}

/* ── Header: steps away after ten quiet seconds ───────── */
const header = $('#header');
let hideTimer;
const armHide = () => { clearTimeout(hideTimer); hideTimer = setTimeout(() => header.classList.add('away'), 10000); };
document.addEventListener('mousemove', e => {
  if (!header.classList.contains('away')) armHide();
  else if (e.clientY < 140) { header.classList.remove('away'); armHide(); }
});
document.addEventListener('touchstart', () => { header.classList.remove('away'); armHide(); }, { passive: true });
armHide();

/* ── Focus: the portrait steps forward ────────────────── */
const veil = $('#veil');
const focusEl = $('#focus');
const focusImg = focusEl.querySelector('.relief');
const focusTint = focusEl.querySelector('.tint-img');
const focusCap = focusEl.querySelector('figcaption');
let focusI = page.slug ? bySlug(page.slug) : null;

function panWall(dx, dy) {
  stopGlide();
  const x0 = offX, y0 = offY, t0 = performance.now();
  (function step(t) {
    const k = Math.min(1, (t - t0) / 1250);
    /* starts soft, lands softer */
    const e = k < 0.4 ? 2.5 * k * k * 0.625 : 1 - Math.pow(1 - k, 2.6);
    offX = x0 + dx * e; offY = y0 + dy * e;
    place();
    if (k < 1) requestAnimationFrame(step);
  })(t0);
}

function openFocus(i, tileEl) {
  clearTimeout(focusRest);   /* a portrait still gliding home is called straight back */
  const p = people[i], f = p.fit;
  focusI = i;
  focusImg.src = p.img;
  focusImg.removeAttribute('srcset');
  focusImg.alt = `${p.name}, portrait in plaster relief`;
  focusImg.className = 'relief' + (p.photo ? ' photo' : '');
  focusImg.style.transform = `translate(${f.dx}%,${f.dy}%) scale(${f.s})`;
  focusImg.style.display = '';
  if (focusCap) focusCap.textContent = p.name;
  focusTint.style.background = `radial-gradient(ellipse 60% 60% at 50% 48%, ${p.tint} 0%, transparent 75%)`;
  veil.classList.add('show');

  if (tileEl) {
    /* FLIP: start exactly over the clicked tile, then glide to the place of honour */
    const r = tileEl.getBoundingClientRect();
    const mobile = innerWidth <= 768;
    const size = focusEl.offsetWidth;   /* the portrait's final size, as the stylesheet sets it */
    const fx = mobile ? innerWidth / 2 : (innerWidth - panel.getBoundingClientRect().width) / 2;
    const fy = mobile ? innerHeight * 0.21 : innerHeight / 2;
    const dx = r.left + r.width / 2 - fx, dy = r.top + r.height / 2 - fy;
    focusEl.style.transition = 'none';
    focusEl.style.opacity = '1';
    focusEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${r.width / size})`;
    focusEl.getBoundingClientRect();
    focusEl.style.transition = '';
    focusEl.classList.add('show');
    requestAnimationFrame(() => { focusEl.style.transform = ''; focusEl.style.opacity = ''; });
    /* the wall drifts gently the way the portrait travels */
    panWall(-dx * 0.22, -dy * 0.22);
  } else {
    focusEl.classList.add('show');
  }
}

let focusRest = 0;
const onScreen = t => { const r = t.getBoundingClientRect(); return r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight; };
function closeFocus() {
  const i = focusI;
  veil.classList.remove('show');
  /* Stepping back from the wall: the portrait glides down onto its own tile and
     sinks into it, as it came. With no tile in view it simply fades. */
  if (focusEl.classList.contains('show') && i !== null && !still.matches) {
    const tile = [...pool.values()].find(t => +t.dataset.i === i && onScreen(t));
    if (tile) {
      const r = tile.getBoundingClientRect(), box = focusEl.getBoundingClientRect();
      const dx = r.left + r.width / 2 - (box.left + box.width / 2), dy = r.top + r.height / 2 - (box.top + box.height / 2);
      focusEl.style.transition = 'transform 1.05s cubic-bezier(0.3,0.9,0.25,1), opacity 0.7s ease 0.35s';
      focusEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${r.width / focusEl.offsetWidth})`;
      focusEl.style.opacity = '0';
      clearTimeout(focusRest);
      focusRest = setTimeout(() => {
        focusEl.style.transition = 'none';
        focusEl.style.transform = ''; focusEl.style.opacity = '';
        focusEl.getBoundingClientRect();
        focusEl.style.transition = '';
      }, 1150);
    }
  }
  focusEl.classList.remove('show');
  focusI = null;
}

/* ── Panel ───────────────────────────────────────────── */
const panel = $('#panel');
const panelBody = $('#panel-body');
const panelLabel = $('#panel-label');
const modes = { search: 'mode-search', profile: 'mode-profile', nominate: 'mode-nominate' };

function openPanel(mode, label) {
  for (const id of Object.values(modes)) document.getElementById(id).classList.remove('active');
  document.getElementById(modes[mode]).classList.add('active');
  panelLabel.textContent = label;
  panel.classList.toggle('ask', mode === 'search');
  panel.classList.add('open');
}
/* ── Settling: what comes into the sheet surfaces gently ── */
/* Each block rises a few pixels and comes up out of the plaster as it enters view:
   all at once when a life opens (one after another), or as the reader scrolls down to it. */
const still = matchMedia('(prefers-reduced-motion: reduce)');
let settler = null;
function settle(nodes, delay = 0) {
  if (still.matches || !('IntersectionObserver' in window)) return;
  settler ||= new IntersectionObserver(entries => {
    const arriving = entries.filter(en => en.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    arriving.forEach((en, k) => {
      const el = en.target;
      settler.unobserve(el);
      const wait = (el.settleDelay || 0) + Math.min(k, 9) * 60;
      el.style.transitionDelay = wait + 'ms';
      el.classList.add('in');
      setTimeout(() => { el.classList.remove('settle', 'in'); el.style.transitionDelay = ''; }, wait + 1000);
    });
  }, { root: panelBody, rootMargin: '0px 0px -3% 0px', threshold: 0.01 });
  for (const el of nodes) {
    if (!el || el.hidden) continue;
    el.settleDelay = delay;
    el.classList.add('settle');
    settler.observe(el);
  }
}
function settleProfile(delay) {
  const blocks = [...profileEl.children].filter(el => !el.matches('.tl, .r-photos, .r-correct'));
  settle([...blocks, ...profileEl.querySelectorAll('.tl-item, .print')], delay);
}

function closePanel() {
  panel.classList.remove('open', 'tall');
  clearMatch();
}
function closeAll() { closePanel(); closeFocus(); goHome(); }

veil.addEventListener('click', closeAll);
$('#panel-x').addEventListener('click', closeAll);
addEventListener('keydown', e => {
  if (e.key === 'Escape' && (panel.classList.contains('open') || focusEl.classList.contains('show'))) closeAll();
});
/* the name in the header leads home; on the wall that just means stepping back */
$('#header .title')?.addEventListener('click', e => {
  if (e.currentTarget.tagName !== 'A' || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  closeAll();
});

/* ── Phone sheet: drag its head down to put it away ──── */
const panelHead = $('#panel-head');
let pull = null;   /* { y, t, dy } while a finger holds the sheet's head */
panelHead.addEventListener('pointerdown', e => {
  if (innerWidth > 768 || e.target.closest('button')) return;
  pull = { y: e.clientY, t: performance.now(), dy: 0 };
  panelHead.setPointerCapture(e.pointerId);
  panel.style.transition = 'none';
});
panelHead.addEventListener('pointermove', e => {
  if (!pull) return;
  pull.dy = Math.max(0, e.clientY - pull.y);
  panel.style.transform = `translateY(${pull.dy}px)`;
});
const letGo = () => {
  if (!pull) return;
  const { dy, t } = pull;
  pull = null;
  /* hand back to the stylesheet: the sheet glides on from wherever the finger left it */
  panel.style.transition = '';
  panel.style.transform = '';
  if (dy > 90 || (dy > 30 && dy / (performance.now() - t) > 0.5)) closeAll();
};
panelHead.addEventListener('pointerup', letGo);
panelHead.addEventListener('pointercancel', letGo);

/* reading on down a life, the phone sheet rises over the portrait; back at the top, it settles */
panelBody.addEventListener('scroll', () => {
  if (innerWidth > 768 || !profileEl.classList.contains('active')) return;
  const y = panelBody.scrollTop;
  if (y > 60) panel.classList.add('tall');
  else if (y < 10) panel.classList.remove('tall');
}, { passive: true });

/* iOS keeps the page full height while its keyboard is up; lift the sheet above it */
if (window.visualViewport && coarse.matches) {
  const vv = window.visualViewport;
  const lift = () => document.documentElement.style.setProperty('--kb',
    Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) + 'px');
  vv.addEventListener('resize', lift);
  vv.addEventListener('scroll', lift);
}

/* ── Profiles: written by the build, fetched as needed ── */
const profileEl = $('#mode-profile');
const profiles = new Map();
if (page.slug) profiles.set(page.slug, Promise.resolve(profileEl.innerHTML));
function loadProfile(slug) {
  if (!profiles.has(slug)) {
    profiles.set(slug, fetch(`${BASE}people/${slug}/profile.html?v=${site.v}`).then(r => {
      if (!r.ok) throw new Error('profile ' + r.status);
      return r.text();
    }).catch(e => { profiles.delete(slug); throw e; }));
  }
  return profiles.get(slug);
}

async function openProfile(i, push = true) {
  const p = people[i];
  if (push) goPerson(p);
  /* already reading a life: it fades away first, and the next one settles in its place */
  const wasOpen = panel.classList.contains('open');
  const swapping = wasOpen && profileEl.classList.contains('active') && profileEl.childElementCount && !still.matches;
  if (swapping) profileEl.classList.add('leaving');
  let html;
  try { [html] = await Promise.all([loadProfile(p.slug), swapping ? sleep(200) : null]); }
  catch { location.href = personURL(p); return; }   /* offline cache miss: just go there */
  profileEl.innerHTML = html;
  profileEl.classList.remove('leaving');
  openPanel('profile', UI.fromWall);
  /* every mode shares the scroll; a new life starts at the top */
  panelBody.scrollTop = 0;
  /* a sheet still sliding in is let arrive a little before its words surface */
  settleProfile(wasOpen ? 0 : 220);
}

function openPerson(i, tileEl) {
  openFocus(i, tileEl);
  openProfile(i);
}

/* a link to another life on the wall opens that life here, as a click on the portrait would */
profileEl.addEventListener('click', e => {
  const a = e.target.closest('a[href]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.closest('.print')) return;
  const url = new URL(a.href, location.href);
  const m = url.origin === location.origin && url.pathname.match(/\/people\/([^/]+)\/?$/);
  const i = m ? bySlug(decodeURIComponent(m[1])) : -1;
  if (i < 0) return;
  e.preventDefault();
  openFocus(i, [...pool.values()].find(t => +t.dataset.i === i));
  openProfile(i);
});

/* the full story folds open under its button */
profileEl.addEventListener('click', e => {
  const b = e.target.closest('[data-story]');
  if (!b) return;
  const story = profileEl.querySelector('.r-story');
  const opening = !story.classList.contains('open');
  b.textContent = opening ? b.dataset.close : b.dataset.open;
  if (still.matches) {
    story.classList.toggle('open', opening);
    if (!opening) story.scrollIntoView({ block: 'start' });
    return;
  }
  /* "none" cannot be animated to, so the story grows to its measured height, then lets go
     (a timer, not transitionend: a fold that follows would otherwise trip a stale listener) */
  clearTimeout(story.unfolding);
  if (opening) {
    story.style.maxHeight = story.scrollHeight + 'px';
    story.classList.add('open');
    story.unfolding = setTimeout(() => { story.style.maxHeight = 'none'; }, 1150);
  } else {
    story.style.maxHeight = story.scrollHeight + 'px';
    story.getBoundingClientRect();   /* start the fold from the full height */
    story.classList.remove('open');
    story.style.maxHeight = '';
    story.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

/* ── Photographs: a print, enlarged ───────────────────── */
const lb = $('#lightbox');
const lbImg = lb.querySelector('img'), lbCap = lb.querySelector('.lb-caption'), lbCredit = lb.querySelector('.lb-credit'), lbCount = lb.querySelector('.lb-count');
let prints = [], printAt = 0, beforePrint = null;
function showPrint(i) {
  printAt = (i + prints.length) % prints.length;
  const a = prints[printAt];
  lbImg.src = a.getAttribute('href');
  lbImg.alt = a.querySelector('img').alt;
  /* old photos are often small: let one grow to about twice its size, no more, to fill the view */
  const w = +a.dataset.w, h = +a.dataset.h;
  if (w && h) {
    const phone = innerWidth <= 768;
    const k = Math.min(2.2, (phone ? 0.62 : 0.72) * innerHeight / h, (phone ? innerWidth - 40 : Math.min(innerWidth * 0.8, 1100)) / w);
    lbImg.style.width = Math.round(w * k) + 'px';
    lbImg.style.height = Math.round(h * k) + 'px';
  }
  lbCap.textContent = a.dataset.caption || '';
  lbCredit.textContent = a.dataset.credit || '';
  lbCount.textContent = `${printAt + 1} / ${prints.length}`;
  /* the next print is fetched while this one is looked at */
  if (prints.length > 1) new Image().src = prints[(printAt + 1) % prints.length].getAttribute('href');
}
function openPrint(a) {
  prints = [...profileEl.querySelectorAll('.print a')];
  beforePrint = document.activeElement;
  lb.classList.toggle('single', prints.length < 2);
  showPrint(prints.indexOf(a));
  lb.hidden = false;
  requestAnimationFrame(() => lb.classList.add('show'));
  lb.querySelector('.lb-close').focus({ preventScroll: true });
}
function closePrint() {
  lb.classList.remove('show');
  setTimeout(() => { if (!lb.classList.contains('show')) { lb.hidden = true; lbImg.removeAttribute('src'); } }, 450);
  beforePrint?.focus?.({ preventScroll: true });
}
profileEl.addEventListener('click', e => {
  const a = e.target.closest('.print a');
  if (!a || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  openPrint(a);
});
let swipeX = null, swiped = false;
lb.querySelector('.lb-close').addEventListener('click', closePrint);
lb.querySelector('.lb-prev').addEventListener('click', () => showPrint(printAt - 1));
lb.querySelector('.lb-next').addEventListener('click', () => showPrint(printAt + 1));
lb.addEventListener('click', e => {
  if (swiped) { swiped = false; return; }   /* the end of a swipe is not a click on the backdrop */
  if (e.target === lb || e.target.tagName === 'FIGURE') closePrint();
});
/* while a print is enlarged, the keys belong to it: Escape puts it down, not the whole panel */
addEventListener('keydown', e => {
  if (lb.hidden) return;
  if (e.key === 'Escape') closePrint();
  else if (e.key === 'ArrowLeft') showPrint(printAt - 1);
  else if (e.key === 'ArrowRight') showPrint(printAt + 1);
  else return;
  e.preventDefault();
  e.stopPropagation();
}, true);
/* a finger swipes from one print to the next */
lb.addEventListener('pointerdown', e => { swipeX = e.clientX; });
lb.addEventListener('pointerup', e => {
  if (swipeX === null || prints.length < 2) return;
  const dx = e.clientX - swipeX;
  swipeX = null;
  if (Math.abs(dx) > 50) { swiped = true; showPrint(printAt + (dx < 0 ? 1 : -1)); }
});

/* ── Addresses: each person has a page of their own ───── */
function goPerson(p) {
  if (location.pathname !== personURL(p)) history.pushState({ slug: p.slug }, '', personURL(p));
  document.title = p.title;
}
function goHome() {
  if (location.pathname !== BASE) history.pushState({}, '', BASE);
  document.title = site.homeTitle;
}
addEventListener('popstate', () => {
  const m = location.pathname.match(/\/people\/([^/]+)\/?$/);
  const i = m ? bySlug(decodeURIComponent(m[1])) : -1;
  if (i >= 0) { openFocus(i, null); openProfile(i, false); document.title = people[i].title; }
  else { closePanel(); closeFocus(); document.title = site.homeTitle; }
});

/* ── Search the wall: a search across every life ─────── */
const input = $('#story-input');
const sendBtn = $('#send-btn');
const convLog = $('#conv-log');
/* every mode shares one scroll: only pin it to the newest line while the search is the one showing */
const scrollLog = () => { if (panel.classList.contains('ask')) panelBody.scrollTop = panelBody.scrollHeight; };

$('#btn-ask').addEventListener('click', () => {
  closeFocus();
  goHome();
  openPanel('search', UI.ask);
  scrollLog();
  loadIndex().catch(() => {});
  setTimeout(() => input.focus(), 750);
});
sendBtn.addEventListener('click', () => { hideSuggest(); ask(); });

/* Names offered while typing: the wall's own names, so a visitor who half-remembers
   one, or only knows "Abdul", sees at once who is here. ↑ ↓ choose, Enter opens. */
const suggestEl = $('#suggest');
let suggested = [], suggestAt = -1;
function nameMatches(v) {
  const qn = canon(norm(v));
  if (qn.length < 2 || !index) return [];
  const qw = qn.split(' ');
  const out = [];
  for (const e of index) {
    let best = 0;
    for (const n of [e.d.name, ...(e.d.aka || [])]) {
      const nn = canon(norm(n)), nw = nn.split(' ');
      const s = nn.startsWith(qn) ? 4 : qw.every(w => nw.some(x => x.startsWith(w))) ? 3 : nn.includes(qn) ? 2 : 0;
      best = Math.max(best, s);
    }
    if (best) out.push({ d: e.d, s: best });
  }
  return out.sort((a, b) => b.s - a.s || a.d.name.localeCompare(b.d.name)).slice(0, 6).map(x => x.d);
}
function hideSuggest() { suggestEl.hidden = true; suggested = []; suggestAt = -1; input.removeAttribute('aria-activedescendant'); }
function drawSuggest() {
  const v = input.value.trim();
  /* a question is being written, not a name: step out of the way */
  suggested = v.split(/\s+/).length > 4 ? [] : nameMatches(v);
  if (!suggested.length) { hideSuggest(); return; }
  const qw = canon(norm(v)).split(' ');
  suggestAt = Math.min(suggestAt, suggested.length - 1);
  suggestEl.innerHTML = suggested.map((d, k) => {
    const p = people[bySlug(d.slug)];
    const name = d.name.split(/(\s+)/).map(w => { const n = canon(norm(w)); return n && qw.some(x => n.startsWith(x)) ? `<em class="hl">${esc(w)}</em>` : esc(w); }).join('');
    return `<li id="sg-${k}" role="option" aria-selected="${k === suggestAt}" class="${k === suggestAt ? 'on' : ''}" data-slug="${esc(d.slug)}"><span class="sg-name">${name}</span><span class="sg-sub">${esc(p?.years || '')}</span></li>`;
  }).join('');
  suggestEl.hidden = false;
  if (suggestAt >= 0) input.setAttribute('aria-activedescendant', `sg-${suggestAt}`);
}
function chooseSuggest(slug) {
  const i = bySlug(slug);
  hideSuggest();
  if (i < 0) return;
  input.value = '';
  openFocus(i, [...pool.values()].find(t => +t.dataset.i === i));
  openProfile(i);
}
input.addEventListener('input', () => {
  suggestAt = -1;
  if (index) drawSuggest(); else loadIndex().then(drawSuggest).catch(() => {});
});
input.addEventListener('blur', () => setTimeout(hideSuggest, 150));
suggestEl.addEventListener('pointerdown', e => {
  const li = e.target.closest('li');
  if (!li) return;
  e.preventDefault();   /* keep the box focused until the choice is made */
  chooseSuggest(li.dataset.slug);
});
input.addEventListener('keydown', e => {
  const open = !suggestEl.hidden && suggested.length;
  if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    /* -1 is the typed text itself: the choice cycles through it, as a browser's own list does */
    const n = suggested.length;
    suggestAt = e.key === 'ArrowDown' ? (suggestAt + 1 >= n ? -1 : suggestAt + 1) : (suggestAt - 1 < -1 ? n - 1 : suggestAt - 1);
    drawSuggest();
    return;
  }
  if (open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideSuggest(); return; }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (open && suggestAt >= 0) chooseSuggest(suggested[suggestAt].slug);
    else { hideSuggest(); ask(); }
  }
});

/* The search reads the question the way a reader would: it knows word forms
   (translator, translation), related words (doctor: health, leprosy), the old names
   of places (Akyab, Rangoon, Myo Haung), typos, and filters spoken in plain words
   ("women", "born in 1935", "died in Yangon", "the 1970s"). Asked a fact about one
   person ("when was Jafar born?") it answers the fact itself. */

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[‘’'`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/* the same place under its old and new names, spelled one way */
const PLACE_NAMES = [
  [/\bakyab\b/g, 'sittwe'], [/\brangoon\b/g, 'yangon'], [/\bmyo ?haung\b|\bmrohaung\b|\bmrauk ?u\b/g, 'mrauku'],
  [/\bmongdu\b|\bmaungdo\b/g, 'maungdaw'], [/\bbuchidong\b|\bbuthidong\b/g, 'buthidaung'], [/\brasidong\b/g, 'rathedaung'],
  [/\bsandoway\b/g, 'thandwe'], [/\btaunggok\b/g, 'taungup'], [/\bbawli ?baza+r\b/g, 'bawlibazaar'], [/\bburma\b/g, 'myanmar'],
];
/* and one spelling for the names written many ways in English */
const NAME_SPELLINGS = [
  [/\bmu?h[ao]mm?[ae]d\b/g, 'muhammad'], [/\bahm[ae]d\b/g, 'ahmad'], [/\bh[uo]ss?a?[ei]i?n\b/g, 'hussain'],
  [/\bnoo?r\b/g, 'nur'], [/\brash[ei]e?d\b/g, 'rashid'], [/\babdu\b/g, 'abdul'], [/\bulla\b/g, 'ullah'],
  [/\byou?s[ou]f\b/g, 'yusuf'], [/\bsel[ie]m\b/g, 'salim'], [/\bjaff?ar\b/g, 'jafar'], [/\bmaracan\b|\bmarkin\b|\bmarkan\b/g, 'marakan'],
];
const canon = s => [...PLACE_NAMES, ...NAME_SPELLINGS].reduce((t, [re, to]) => t.replace(re, to), s);

/* Porter's stemmer: translation, translated, translator → translat */
const stem = (() => {
  const step2 = { ational: 'ate', tional: 'tion', enci: 'ence', anci: 'ance', izer: 'ize', bli: 'ble', alli: 'al', entli: 'ent', eli: 'e', ousli: 'ous',
    ization: 'ize', ation: 'ate', ator: 'ate', alism: 'al', iveness: 'ive', fulness: 'ful', ousness: 'ous', aliti: 'al', iviti: 'ive', biliti: 'ble', logi: 'log' };
  const step3 = { icate: 'ic', ative: '', alize: 'al', iciti: 'ic', ical: 'ic', ful: '', ness: '' };
  const c = '[^aeiou]', v = '[aeiouy]', C = c + '[^aeiouy]*', V = v + '[aeiou]*';
  const mgr0 = new RegExp('^(' + C + ')?' + V + C), meq1 = new RegExp('^(' + C + ')?' + V + C + '(' + V + ')?$');
  const mgr1 = new RegExp('^(' + C + ')?' + V + C + V + C), sv = new RegExp('^(' + C + ')?' + v);
  const cvc = new RegExp('^' + C + v + '[^aeiouwxy]$');
  const memo = new Map();
  return word => {
    if (memo.has(word)) return memo.get(word);
    let w = word, m;
    if (w.length < 3 || /\d/.test(w)) { memo.set(word, w); return w; }
    const y = w[0] === 'y';
    if (y) w = 'Y' + w.slice(1);
    if ((m = /^(.+?)(ss|i)es$/.exec(w))) w = m[1] + m[2];
    else if ((m = /^(.+?)([^s])s$/.exec(w))) w = m[1] + m[2];
    if ((m = /^(.+?)eed$/.exec(w))) { if (mgr0.test(m[1])) w = w.slice(0, -1); }
    else if ((m = /^(.+?)(ed|ing)$/.exec(w)) && sv.test(m[1])) {
      w = m[1];
      if (/(at|bl|iz)$/.test(w)) w += 'e';
      else if (/([^aeiouylsz])\1$/.test(w)) w = w.slice(0, -1);
      else if (cvc.test(w)) w += 'e';
    }
    if ((m = /^(.+?)y$/.exec(w)) && sv.test(m[1])) w = m[1] + 'i';
    if ((m = /^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/.exec(w)) && mgr0.test(m[1])) w = m[1] + step2[m[2]];
    if ((m = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/.exec(w)) && mgr0.test(m[1])) w = m[1] + step3[m[2]];
    if ((m = /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/.exec(w))) { if (mgr1.test(m[1])) w = m[1]; }
    else if ((m = /^(.+?)(s|t)(ion)$/.exec(w)) && mgr1.test(m[1] + m[2])) w = m[1] + m[2];
    if ((m = /^(.+?)e$/.exec(w)) && (mgr1.test(m[1]) || (meq1.test(m[1]) && !cvc.test(m[1])))) w = m[1];
    if (/ll$/.test(w) && mgr1.test(w)) w = w.slice(0, -1);
    if (y) w = 'y' + w.slice(1);
    memo.set(word, w);
    return w;
  };
})();
const terms = s => canon(norm(s)).split(' ').filter(Boolean).map(stem);

/* words that mean much the same on this wall */
const KIN = new Map();
for (const group of [
  'doctor physician medical medicine health hospital clinic leprosy nurse healthcare',
  'writer author novelist novel novels wrote writing written books book essays literature literary',
  'poet poetry poem poems verse',
  'editor editing edited magazine journal newspaper journalist publisher publishing',
  'translator translation translated translate translations',
  'leader leadership revolutionary founder founded president',
  'revolutionary resistance rebel rebellion armed mujahid fighter fought fight struggle freedom independence liberation',
  'politician politics political parliament parliamentarian legislative legislator representative minister election elected mp assembly constituent',
  'activist activism rights justice advocate advocacy campaigner',
  'police policeman inspector crime criminal criminals bandit bandits',
  'lawyer barrister legal magistrate judge attorney',
  'business businessman merchant trader trade trading commerce commercial wealthy rich wealth wealthiest shipping',
  'teacher teaching taught school schools education educator professor lecturer academic headmaster principal',
  'scholar alim islamic islam quran koran mosque religious religion muslim maulana qari imam hadith cleric preacher spiritual',
  'singer singing song songs music musician performer',
  'media broadcaster broadcast broadcasting radio television tv news journalist journalism blogger blog',
  'historian history historical',
  'script alphabet orthography hanifi',
  'founder founded cofounder established',
  'organisation organization union coalition association society',
  'student students university college',
  'philanthropist philanthropy charity charitable generous donated donation',
  'covid coronavirus pandemic',
  'persecution genocide oppression discrimination',
  'military army soldier soldiers',
  'arakan rakhine arakanese',
]) {
  const words = group.split(' ').map(stem);
  for (const w of words) KIN.set(w, new Set([...(KIN.get(w) || []), ...words.filter(x => x !== w)]));
}

const STOP = new Set(('a an the of in on at to for and or but is was were be been being who whom whose what which where when how why with from by ' +
  'about tell me us show find give any some person people someone anyone everyone rohingya rohingyas famous i you it its this that these those there ' +
  'are did do does has had have can could would should will please know looking want wall search list name names named called life lives story ' +
  'he she his her him hers they them their one first').split(' '));
const HONORIFIC = new Set('u daw saya sayagyi mr mrs ms dr maulana molvi haji hajji sheikh'.split(' '));
const FEMALE = new Set('woman women female females lady ladies girl girls mother mothers poetess'.split(' '));
const MALE = new Set('man men male males gentleman gentlemen'.split(' '));
const BORN = new Set(['born', 'birth', 'birthday', 'birthplace', 'native', 'hometown']);
const DIED = new Set(['died', 'die', 'dies', 'death', 'passed', 'buried', 'deathplace']);
const ASK_WORDS = new Set(['when', 'where', 'old', 'age', 'aged', 'year', 'years', 'date', 'real', 'birth', 'known', 'alias', 'pen', 'nickname', 'quote', 'said', 'say', 'words', 'saying']);

const ALLY_WORDS = new Set('ally allies supporter supporters friend friends foreigner foreigners international helped'.split(' '));

const FIELDS = { name: [10, 0.3], role: [5, 0.3], place: [4, 0.3], quote: [2, 0.6], intro: [3, 0.75], tl: [2, 0.75], bio: [1, 0.75] };
let index = null, indexing = null, avgLen = {}, docFreq = new Map(), surface = new Map(), placeTerms = new Set(), nameVocab = new Set();

function loadIndex() {
  return indexing ||= fetch(`${BASE}data/search.json?v=${site.v}`).then(r => r.json()).then(docs => {
    const sum = {};
    index = docs.map(d => {
      const text = {
        name: [d.name, ...(d.aka || [])].join(' '),
        role: [d.role, ...(d.categories || []), d.epithet].join(' '),
        place: [d.place, d.birthplace, d.deathplace].join(' '),
        quote: d.quote || '', intro: d.intro, tl: d.timeline, bio: d.bio,
      };
      const tf = {}, len = {}, all = new Set();
      for (const f in FIELDS) {
        const ts = terms(text[f]);
        tf[f] = new Map();
        for (const t of ts) { tf[f].set(t, (tf[f].get(t) || 0) + 1); all.add(t); }
        len[f] = ts.length;
        sum[f] = (sum[f] || 0) + ts.length;
      }
      for (const t of all) docFreq.set(t, (docFreq.get(t) || 0) + 1);
      for (const w of canon(norm(Object.values(text).join(' '))).split(' ')) if (w) {
        const t = stem(w);
        if (!surface.has(t)) surface.set(t, w);
      }
      for (const t of terms(text.place)) placeTerms.add(t);
      /* each name the person is known by, as its parts: "U Mya Than" → mya, than */
      const names = [d.name, ...(d.aka || [])].map(n => terms(n).filter(t => t.length > 1 && !HONORIFIC.has(t))).filter(n => n.length);
      const nameParts = names.flat();
      for (const part of nameParts) nameVocab.add(part);
      return { d, tf, len, names, nameParts };
    });
    for (const f in FIELDS) avgLen[f] = (sum[f] || 1) / index.length;
    return index;
  }).catch(e => { indexing = null; throw e; });
}

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/* BM25F: a term counts for more in the name than in the biography, and for more
   when few lives mention it */
function score(e, t) {
  const df = docFreq.get(t);
  if (!df) return 0;
  let tf = 0;
  for (const f in FIELDS) {
    const n = e.tf[f].get(t);
    if (!n) continue;
    const [w, b] = FIELDS[f];
    tf += w * n / (1 - b + b * e.len[f] / avgLen[f]);
  }
  if (!tf) return 0;
  const idf = Math.log(1 + (index.length - df + 0.5) / (df + 0.5));
  return (0.3 + idf) * tf / (1.2 + tf);
}

/* every form a word in the question may take on the wall */
function variants(t) {
  const out = [[t, 1]];
  for (const k of KIN.get(t) || []) out.push([k, 0.75]);
  if (!docFreq.has(t) && t.length >= 4 && !/\d/.test(t)) {
    for (const known of docFreq.keys()) {
      if (known.length < 4 || /\d/.test(known)) continue;
      const d = lev(t, known);
      if (d <= (t.length >= 7 ? 2 : 1)) out.push([known, d === 1 ? 0.7 : 0.55]);
    }
  }
  return out;
}

const yearOf = s => /^\d{4}/.test(s || '') ? +String(s).slice(0, 4) : null;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const onDate = s => {
  const m = String(s || '').match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (!m) return '';
  if (m[3]) return `on ${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
  if (m[2]) return `in ${MONTHS[+m[2] - 1]} ${m[1]}`;
  return `in ${m[1]}`;
};
function ageAt(d) {
  const b = String(d.born || ''), x = String(d.died || '');
  if (!/^\d{4}/.test(b) || !/^\d{4}/.test(x)) return null;
  if (b.length === 10 && x.length === 10) {
    const [by, bm, bd] = b.split('-').map(Number), [dy, dm, dd] = x.split('-').map(Number);
    return { n: dy - by - (dm < bm || (dm === bm && dd < bd) ? 1 : 0), exact: true };
  }
  return { n: +x.slice(0, 4) - +b.slice(0, 4), exact: false };
}

/* a fact about one person, said plainly */
function fact(d, words) {
  const p = people[bySlug(d.slug)], P = p.gender === 'female' ? 'She' : 'He';
  const asks = w => words.some(x => w.includes(x));
  const circa = /^c\./.test(p.years || '');   /* "c. 1939": the year is only known roughly */
  const bornOn = d.born ? (circa ? `around ${yearOf(d.born)}` : onDate(d.born)) : '';
  const age = ageAt(d);
  if (age && circa) age.exact = false;
  if (asks(['alias', 'known', 'real', 'pen', 'nickname']) && d.aka?.length)
    return `${d.name} is also known as ${d.aka.join(', ')}.`;
  if (asks(['quote', 'said', 'say', 'saying', 'words']) && d.quote)
    return `In ${p.gender === 'female' ? 'her' : 'his'} words: “${d.quote}”`;
  if (asks(['old', 'age', 'aged']) && age)
    return `${d.name} was ${age.exact ? '' : 'about '}${age.n} at ${p.gender === 'female' ? 'her' : 'his'} death${d.died ? `, ${onDate(d.died)}` : ''}.`;
  if (asks([...DIED]) && (d.died || d.deathplace))
    return `${d.name} died${d.died ? ' ' + onDate(d.died) : ''}${d.deathplace ? ` in ${d.deathplace}` : ''}${age ? `, aged ${age.exact ? '' : 'about '}${age.n}` : ''}.`;
  if (asks([...BORN, 'when', 'where', 'from']) && (d.born || d.birthplace)) {
    if (asks(['where', 'from', 'birthplace', 'hometown']) && d.birthplace) return `${d.name} was born in ${d.birthplace}${bornOn ? `, ${bornOn}` : ''}.`;
    return `${d.name} was born${bornOn ? ' ' + bornOn : ''}${d.birthplace ? ` in ${d.birthplace}` : ''}.`;
  }
  if (asks(['when'])) return d.from ? `${d.name} lived ${d.to ? `from ${d.from} to ${d.to}` : `from ${d.from}`}.` : '';
  return '';
}

/* Does a word of the question name this part of a person's name? A word that is itself
   a name on the wall is taken as written: Jafar is not Zafar, Abdul is not Abul or
   Abdullah. Only a word the wall does not know is read as a typo or the start of a name. */
const namesPart = (t, part) => t === part || (!nameVocab.has(t) && (
  (t.length >= 4 && part.length >= 4 && lev(t, part) <= (t.length >= 7 ? 2 : 1)) ||
  (t.length >= 4 && part.startsWith(t))));

const COUNT = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const counted = n => COUNT[n] || String(n);

function search(q) {
  const raw = canon(norm(q)).split(' ').filter(Boolean);
  if (!raw.length) return { slugs: [], stems: [] };
  const words = raw.map(stem);
  const filters = {};
  const near = (i, set) => raw.slice(Math.max(0, i - 3), i).some(w => set.has(w));
  const asking = raw.some(w => ASK_WORDS.has(w) || BORN.has(w) || DIED.has(w));
  const hasAllies = index.some(e => (e.d.categories || []).some(c => /worked for/i.test(c)));
  const content = [];
  raw.forEach((w, i) => {
    const t = words[i];
    if (/^\d{4}s?$/.test(w)) {
      const y = parseInt(w, 10);
      if (w.endsWith('s') || raw[i + 1] === 's') filters.decade = y - (y % 10);
      else if (near(i, BORN)) filters.bornYear = y;
      else if (near(i, DIED)) filters.diedYear = y;
      else filters.year = y;
      return;
    }
    if (FEMALE.has(w)) { filters.gender = 'female'; return; }
    if (MALE.has(w)) { filters.gender = 'male'; return; }
    if (hasAllies && ALLY_WORDS.has(w)) { filters.allies = true; return; }
    if (BORN.has(w) || DIED.has(w) || ASK_WORDS.has(w) || STOP.has(w) || HONORIFIC.has(w) || w === 's' || w.length < 2) return;
    /* "born in Maungdaw", "died in Yangon": the place is a filter on that life's ends */
    if (placeTerms.has(t) && near(i, BORN)) { filters.bornPlace = t; return; }
    if (placeTerms.has(t) && near(i, DIED)) { filters.diedPlace = t; return; }
    content.push(t);
  });
  if (raw.some(w => ['all', 'everyone', 'everybody', 'every'].includes(w)) && !content.length && !Object.keys(filters).length)
    return { slugs: index.map(e => e.d.slug).sort((a, b) => a.localeCompare(b)), stems: [], lead: UI.everyone(index.length) };

  const mentions = (e, y) => new RegExp(`\\b${y}\\b`).test(e.d.intro + ' ' + e.d.timeline + ' ' + e.d.bio);
  const passes = e => {
    const d = e.d;
    if (filters.gender && people[bySlug(d.slug)]?.gender !== filters.gender) return false;
    if (filters.allies && !(d.categories || []).some(c => /worked for/i.test(c))) return false;
    if (filters.bornYear && d.from !== filters.bornYear) return false;
    if (filters.diedYear && d.to !== filters.diedYear) return false;
    if (filters.year && !((d.from && d.to && filters.year >= d.from && filters.year <= d.to) || mentions(e, filters.year))) return false;
    if (filters.decade && !((d.from && d.to && d.from <= filters.decade + 9 && d.to >= filters.decade) ||
      [...Array(10).keys()].some(k => mentions(e, filters.decade + k)))) return false;
    if (filters.bornPlace && !terms([d.birthplace, d.place].join(' ')).includes(filters.bornPlace)) return false;
    if (filters.diedPlace && !terms(d.deathplace).includes(filters.diedPlace)) return false;
    return true;
  };

  const hits = [], matchedStems = new Set(), nameWords = new Set();
  for (const e of index) {
    if (!passes(e)) continue;
    let total = 0, matched = 0, literal = 0;
    for (const t of content) {
      let best = 0, bestTerm = null, exactish = false;
      for (const [alt, w] of variants(t)) {
        const sc = w * score(e, alt);
        if (sc > best) { best = sc; bestTerm = alt; exactish = w >= 0.75; }
      }
      /* a typo guess alone is only half an answer: "Mandela" is not "Mandalay" */
      if (best > 0) { total += best; matched += exactish ? 1 : 0.5; matchedStems.add(bestTerm); }
      if (score(e, t) > 0) literal++;
    }
    /* How the question names this person, by the best of the names they bear:
       qs, the share of the question's words found in that name; ns, the share of the
       name the question gave. "Jafar" is all of B. A. Jafar's name and half of Jafar Kawal's. */
    let qs = 0, ns = 0;
    if (content.length) for (const n of e.names) {
      const parts = n.filter(part => content.some(t => namesPart(t, part)));
      if (!parts.length) continue;
      const said = content.filter(t => n.some(part => namesPart(t, part)));
      const a = said.length / content.length, b = parts.length / n.length;
      if (a + b > qs + ns) {
        qs = a; ns = b;
        for (const t of said) nameWords.add(t);
        for (const part of parts) matchedStems.add(part);
      }
    }
    if (!content.length || matched || qs) hits.push({ e, total, matched, literal, qs, ns });
  }

  if (!content.length) {
    hits.sort((a, b) => a.e.d.name.localeCompare(b.e.d.name));
    return { slugs: hits.map(h => h.e.d.slug), stems: [] };
  }

  /* Everyone who bears the name, closest first. A whole name given ("Abdul Hadi")
     leaves out those who only share part of it; one word ("Abdul") gathers them all. */
  let named = hits.filter(h => h.qs >= 0.5);
  const exact = named.some(h => h.qs === 1 && h.ns === 1);
  if (exact) named = named.filter(h => h.qs === 1);
  named.sort((a, b) => (b.qs + b.ns) - (a.qs + a.ns) || b.total - a.total);
  const namedSet = new Set(named.map(h => h.e));

  /* the label for the name, in the visitor's own spelling */
  const label = q.split(/\s+/).filter(w => terms(w).some(t => nameWords.has(t)))
    .map(w => w.replace(/^\p{Ll}/u, c => c.toUpperCase())).join(' ');

  /* the rest: lives where the words appear, answering every word first, and none that
     answer far more faintly than the best: a passing mention is not an answer */
  const rest = hits.filter(h => !namedSet.has(h.e) && h.matched);
  rest.sort((a, b) => b.matched - a.matched || b.total - a.total);
  /* after a name, only the stories that say that very name; otherwise related words count too */
  const full = named.length ? rest.filter(h => h.literal >= content.length) : rest.filter(h => h.matched >= content.length);
  let others = full.length ? full : (named.length ? [] : rest.filter(h => h.matched >= Math.ceil(content.length / 2)));
  if (others.length) {
    const top = Math.max(...others.map(h => h.total));
    others = others.filter(h => h.total >= top * 0.3);
  }

  /* asked a fact of someone by name: answer it for each who bears that name */
  if (asking && named.length && named.length <= 3) {
    const facts = named.map(h => fact(h.e.d, raw)).filter(Boolean);
    if (facts.length) return { slugs: named.map(h => h.e.d.slug), stems: [...matchedStems], lead: facts.join('\n') };
  }

  if (named.length) {
    const lead = named.length > 1 ? UI.shareName(named.length, label) : '';
    const lead2 = others.length ? UI.alsoIn(label, others.length) : '';
    return { slugs: [...named, ...others].map(h => h.e.d.slug), stems: [...matchedStems], lead, split: named.length, lead2 };
  }
  if (others.length) return { slugs: others.map(h => h.e.d.slug), stems: [...matchedStems], lead: !full.length && content.length > 1 ? UI.partial : '' };

  /* nothing at all: perhaps a name spelled another way */
  const q2 = content.join('');
  let best = null, bestD = 4;
  for (const e of index) {
    for (const cand of [e.nameParts.join(''), ...e.nameParts]) {
      const d = lev(q2, cand);
      if (d < bestD && cand.length >= 4) { bestD = d; best = e; }
    }
  }
  if (best) return { slugs: [best.d.slug], stems: [], lead: UI.didYouMean(best.d.name) };
  return { slugs: [], stems: [] };
}

/* the sentence that best answers the question, with the words that matched picked out */
function snippet(d, stems) {
  const want = new Set(stems);
  const sentences = [d.intro, d.timeline, d.bio].join(' ').split(/(?<=[.!?”"])\s+/).filter(Boolean);
  let s = d.intro.split(/(?<=[.!?])\s+/)[0] || '', best = 0;
  if (want.size) for (const sen of sentences) {
    const n = new Set(terms(sen).filter(t => want.has(t))).size;
    if (n > best) { best = n; s = sen; }
  }
  if (s.length > 240) s = s.slice(0, 236).replace(/\s+\S*$/, '') + '…';
  return s.split(/(\s+)/).map(w => {
    const t = terms(w)[0];
    return t && want.has(t) ? `<em class="hl">${esc(w)}</em>` : esc(w);
  }).join('');
}

let lastSpeaker = null;
function speaker(who) {
  const label = who === lastSpeaker ? '' : `<div class="speaker">${who === 'keeper' ? UI.keeper : ''}</div>`;
  lastSpeaker = who;
  return label;
}
/* the keeper's name is engraved once, when that voice first speaks, not after every question */
/* new lines of the conversation settle in like everything else in the sheet */
function addToLog(html) {
  const before = convLog.childElementCount;
  convLog.insertAdjacentHTML('beforeend', html);
  settle([...convLog.children].slice(before));
}
function youSay(text) {
  addToLog(`<div class="msg you">${esc(text)}</div>`);
}
function keeperSays(inner) {
  addToLog(`<div class="msg her">${speaker('keeper')}<span class="surf">${inner}</span></div>`);
  scrollLog();
}

function hitHTML(p, snip) {
  const i = bySlug(p.slug);
  return `<div class="hit">
    <a class="m-name" href="${personURL(p)}" data-i="${i}">${esc(p.name)}</a>
    <div class="m-era">${esc([p.years, p.sub].filter(Boolean).join('  ·  '))}</div>
    <div class="m-snip">${snip}</div>
    <button class="btn-talk in-chat" data-i="${i}">${esc(UI.readStory(p))}</button>
  </div>`;
}

function answer(q, slugs, stems, lead, split, lead2) {
  const found = slugs.map(s => people[bySlug(s)]).filter(Boolean);
  if (!found.length) {
    keeperSays(esc(UI.notFound));
    addToLog(`<button class="btn-talk in-chat nom-chat">${UI.nominate}</button>`);
    return;
  }
  const cards = list => list.map(p => {
    const doc = index?.find(e => e.d.slug === p.slug)?.d;
    return hitHTML(p, doc ? snippet(doc, stems || []) : esc(p.sub));
  }).join('');
  const first = split ? found.slice(0, split) : found;
  const more = split ? found.slice(split) : [];
  keeperSays(esc(lead || UI.found(first.length)).replace(/\n/g, '<br>'));
  addToLog(cards(first.slice(0, 10)));
  if (first.length > 10) keeperSays(esc(UI.more(first.length - 10)));
  if (more.length) {
    keeperSays(esc(lead2));
    addToLog(cards(more.slice(0, 6)));
    if (more.length > 6) keeperSays(esc(UI.more(more.length - 6)));
  }
}

/* while the keeper searches, light runs over the visible portraits */
function startScan() {
  let last = null;
  const id = setInterval(() => {
    if (last) last.classList.remove('scanning');
    const ts = [...pool.values()];
    last = ts[Math.floor(Math.random() * ts.length)];
    last?.classList.add('scanning');
  }, 230);
  return () => { clearInterval(id); for (const t of pool.values()) t.classList.remove('scanning'); };
}

let matchState = null;   /* { lit: index, matched: Set of indexes } */
function applyMatch(t) {
  const i = +t.dataset.i;
  t.classList.toggle('matched', matchState.matched.has(i));
  t.classList.toggle('lit', i === matchState.lit);
  t.classList.toggle('dimmed-out', !matchState.matched.has(i));
}
function clearMatch() {
  matchState = null;
  for (const t of pool.values()) t.classList.remove('scanning', 'matched', 'dimmed-out', 'lit');
}
function highlight(indexes) {
  matchState = { lit: indexes[0], matched: new Set(indexes) };
  for (const t of pool.values()) applyMatch(t);
  if (focusEl.classList.contains('show') && focusI === indexes[0]) return;
  const tile = [...pool.values()].find(t => +t.dataset.i === indexes[0]);
  openFocus(indexes[0], tile);
}

async function ask() {
  const q = input.value.trim();
  if (!q) { input.focus(); return; }
  input.value = '';
  sendBtn.disabled = true;
  youSay(q);
  convLog.insertAdjacentHTML('beforeend', `<div class="msg thinking" id="thinking">${lastSpeaker === 'keeper' ? '' : `<div class="speaker">${UI.keeper}</div>`}<span class="dots"><i></i><i></i><i></i></span></div>`);
  scrollLog();
  const stopScan = startScan();
  let result;
  try {
    [result] = await Promise.all([loadIndex().then(() => search(q)), sleep(1100)]);
  } catch {
    result = { slugs: [], stems: [] };
  }
  stopScan();
  $('#thinking')?.remove();
  const { slugs, stems, lead, split, lead2 } = result;
  answer(q, slugs, stems, lead, split, lead2);
  remember({ q, slugs, stems, lead, split, lead2 });
  if (slugs.length) highlight(slugs.map(bySlug).filter(i => i >= 0));
  scrollLog();
  sendBtn.disabled = false;
  input.focus();
}

convLog.addEventListener('click', e => {
  if (e.target.closest('.nom-chat')) { openNominate(); return; }
  const t = e.target.closest('[data-i]');
  if (!t || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  const i = +t.dataset.i;
  if (focusI !== i) openFocus(i, [...pool.values()].find(x => +x.dataset.i === i));
  openProfile(i);
});

/* The thread is kept for a month, in this browser only. */
const LOG_KEY = 'rfp-log-2', KEEP_MS = 30 * 24 * 60 * 60 * 1000;
let log = [];
function remember(entry) {
  log.push(entry);
  log = log.slice(-30);
  try { localStorage.setItem(LOG_KEY, JSON.stringify({ log, savedAt: Date.now() })); } catch {}
}
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOG_KEY) || 'null');
    if (!saved || !Array.isArray(saved.log)) return;
    if (Date.now() - saved.savedAt > KEEP_MS) { localStorage.removeItem(LOG_KEY); return; }
    log = saved.log;
    if (!log.length) return;
    loadIndex().then(() => {
      for (const { q, slugs, stems, lead, split, lead2 } of log) { youSay(q); answer(q, slugs, stems || [], lead, split, lead2); }
    }).catch(() => {});
  } catch {}
}

/* ── Sending: Carve a name, and corrections ─────────── */
/* Both go to the site's own mail function. If it cannot be reached, the visitor is
   offered their email app with the message already written, so nothing is lost. */
const formOpened = new WeakMap();   /* when each form was opened: a submission seconds later is a bot */
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

function fieldError(el, msg) {
  const err = el.closest('.field')?.querySelector('.field-error');
  if (err) err.textContent = msg;
  el.style.borderColor = 'rgba(180,80,60,0.6)';
  el.focus();
  setTimeout(() => { el.style.borderColor = ''; if (err) err.textContent = ''; }, 3500);
}
function note(form, html) {
  const n = form.querySelector('.form-note');
  n.innerHTML = html;
  n.hidden = false;
  n.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function send(form, fields, photo) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append('website', form.querySelector('.hp')?.value || '');
  fd.append('elapsed', String(Date.now() - (formOpened.get(form) || Date.now())));
  fd.append('page', location.href);
  if (photo) fd.append('photo', photo, photo.name);
  if (!SUBMIT.endpoint) throw new Error('no endpoint');
  const res = await fetch(SUBMIT.endpoint, { method: 'POST', body: fd });
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).error || ''; } catch {}
    const err = new Error(msg || 'send ' + res.status);
    /* a problem with what was typed is worth saying; anything else falls back to email */
    err.shown = (res.status === 400 || res.status === 413) && msg;
    throw err;
  }
}
function byEmailHTML(subject, lines, withPhoto) {
  if (!SUBMIT.to) return esc(UI.sendFail);
  const body = lines.filter(([, v]) => v).map(([k, v]) => `${k}:\n${v}`).join('\n\n') + (withPhoto ? `\n\n(${UI.attach})` : '');
  const href = `mailto:${SUBMIT.to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `${esc(UI.sendFail)}${withPhoto ? ' ' + esc(UI.attach) : ''}<br><a class="btn-talk in-chat" href="${esc(href)}">${esc(UI.byEmail)}</a>`;
}

/* a phone photo can be many megabytes: send a well-sized JPEG instead */
async function shrinkPhoto(file) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 1.5e6 && /jpe?g|png|webp/.test(file.type)) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
    return blob ? new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;   /* a format the browser cannot read (HEIC on some browsers): send it as it is */
  }
}

/* Carve a name */
const nomForm = $('#nom-form');
function openNominate() {
  closeFocus();
  goHome();
  $('#nom-thanks').hidden = true;
  openPanel('nominate', UI.nominate);
  settle([...document.querySelectorAll('#mode-nominate > .msg.tip, #nom-form > :not(.hp)')], 160);
  formOpened.set(nomForm, Date.now());
  panelBody.scrollTop = 0;
  setTimeout(() => $('#nom-name').focus(), 750);
}
$('#btn-nominate').addEventListener('click', openNominate);

/* A photo field: a carved frame that takes a chosen or dropped picture, shows it, and
   holds a well-sized copy for sending. Carve a name has one, and so does every correction. */
const photos = new WeakMap();   /* form → the photo it will send */
function wirePhoto(form) {
  const drop = form.querySelector('.drop');
  if (!drop || drop.dataset.wired) return;
  drop.dataset.wired = '1';
  const fileIn = drop.querySelector('input[type=file]');
  const text = drop.querySelector('.drop-text'), preview = drop.querySelector('.drop-preview'), clear = drop.querySelector('.drop-clear');
  const label = text.textContent;
  const reset = () => {
    photos.delete(form); fileIn.value = '';
    if (preview.src) URL.revokeObjectURL(preview.src);
    preview.hidden = true; preview.removeAttribute('src');
    text.textContent = label; clear.hidden = true;
  };
  drop.clearPhoto = reset;
  const take = async file => {
    if (!file) return;
    if (!/^image\//.test(file.type) && !/\.(heic|heif)$/i.test(file.name)) { reset(); fieldError(fileIn, UI.photoErr); return; }
    text.textContent = '…';
    const small = await shrinkPhoto(file);
    if (small.size > 4 * 1024 * 1024) { reset(); fieldError(fileIn, UI.photoBig); return; }
    photos.set(form, small);
    preview.src = URL.createObjectURL(small);
    preview.hidden = false;
    text.textContent = file.name;
    clear.hidden = false;
  };
  fileIn.addEventListener('change', () => take(fileIn.files[0]));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); take(e.dataTransfer.files[0]); });
  clear.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); reset(); });
}
const clearPhoto = form => form.querySelector('.drop')?.clearPhoto?.();
wirePhoto(nomForm);

nomForm.addEventListener('submit', async e => {
  e.preventDefault();
  const nameEl = $('#nom-name'), emailEl = $('#nom-email');
  const name = nameEl.value.trim(), email = emailEl.value.trim();
  if (name.length < 2 || !/\p{L}/u.test(name)) return fieldError(nameEl, UI.nomNameErr);
  if (email && !isEmail(email)) return fieldError(emailEl, UI.emailErr);
  const fields = { kind: 'nomination', name, desc: $('#nom-desc').value.trim(), source: $('#nom-source').value.trim(), email };
  const btn = $('#nom-submit');
  const photo = photos.get(nomForm);
  btn.disabled = true;
  try {
    await send(nomForm, fields, photo);
    nomForm.reset(); clearPhoto(nomForm);
    note(nomForm, esc(UI.nomThanks));
  } catch (err) {
    note(nomForm, err.shown ? esc(err.shown) : byEmailHTML(`Carve a name: ${name}`,
      [['Name', name], ['What they did', fields.desc], ['Link', fields.source], ['My email', email]], !!photo));
  } finally {
    btn.disabled = false;
  }
});

/* Submit a correction, under every life */
profileEl.addEventListener('click', e => {
  const b = e.target.closest('[data-correct]');
  if (!b) return;
  const form = profileEl.querySelector('.r-correct');
  const open = form.hidden;
  form.hidden = !open;
  b.setAttribute('aria-expanded', String(open));
  if (open) {
    wirePhoto(form);
    formOpened.set(form, Date.now());
    setTimeout(() => { form.scrollIntoView({ behavior: 'smooth', block: 'start' }); form.querySelector('textarea').focus({ preventScroll: true }); }, 60);
  }
});
profileEl.addEventListener('submit', async e => {
  const form = e.target.closest('.r-correct');
  if (!form) return;
  e.preventDefault();
  const text = form.querySelector('[name=correction]'), emailEl = form.querySelector('[name=email]');
  const correction = text.value.trim(), email = emailEl.value.trim();
  const photo = photos.get(form);
  /* a correction can be words, a photo, or both */
  if (correction.length < 3 && !photo) return fieldError(text, UI.textErr);
  if (email && !isEmail(email)) return fieldError(emailEl, UI.emailErr);
  const person = form.dataset.person;
  const fields = { kind: 'correction', person, correction, source: form.querySelector('[name=source]').value.trim(), email };
  const btn = form.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    await send(form, fields, photo);
    form.reset(); clearPhoto(form);
    note(form, esc(UI.corThanks));
  } catch (err) {
    note(form, err.shown ? esc(err.shown) : byEmailHTML(`Correction: ${person}`,
      [['Person', person], ['Page', location.href], ['What you got wrong', correction], ['Source', fields.source], ['My email', email]], !!photo));
  } finally {
    btn.disabled = false;
  }
});

/* ── Start ───────────────────────────────────────────── */
/* A desktop window keeps its tile size while it is dragged wider or narrower, as the
   original does. A phone or tablet turned on its side, or a window crossing into the
   phone layout, lays the wall out again so the portraits fit the new screen. */
function onResize() {
  const next = tileSize();
  const typing = document.activeElement?.matches?.('input, textarea');
  if (next !== TILE && !typing && (coarse.matches || (next === PHONE_TILE) !== (TILE === PHONE_TILE))) {
    offX *= next / TILE; offY *= next / TILE;
    TILE = next;
    for (const el of pool.values()) el.remove();
    pool.clear();
    resizeSun?.();
  }
  range = '';
  place();
}

document.querySelector('.wall-static')?.remove();
place();
addEventListener('resize', onResize);
/* a life opened fresh is read from its first line, whatever the browser remembers */
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
panelBody.scrollTop = 0;
panel.classList.remove('tall');
restore();

/* /?ask opens the search; /?q=jafar asks it straight away (the address search engines are given) */
const params = new URLSearchParams(location.search);
/* /?carve opens Carve a name, for the links from the index page */
if (params.has('carve')) { history.replaceState({}, '', location.pathname); openNominate(); }
else if (params.has('q') || params.has('ask')) {
  history.replaceState({}, '', location.pathname);
  openPanel('search', UI.ask);
  const q = params.get('q');
  if (q) { input.value = q; ask(); } else setTimeout(() => input.focus(), 750);
}
})();
