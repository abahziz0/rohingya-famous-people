/* POST /api/submit — "Carve a name" nominations and "Submit a correction" notes,
   delivered by email through Resend (https://resend.com).

   Runs as a Vercel Function. Set these in the Vercel project's environment variables:
     RESEND_API_KEY   required: the API key from resend.com
     SUBMIT_TO        optional: where submissions go (default below, from site.config.json)
     SUBMIT_FROM      optional: the sender, e.g. "Rohingya Famous People <wall@your-domain>".
                      Resend's test sender (the default) only delivers to the address the
                      Resend account was opened with, until you verify your own domain there.

   The address never appears in the page; visitors only ever see this endpoint. */

const DEFAULT_TO = 'ab@rohingya.ro';
const DEFAULT_FROM = 'Rohingya Famous People <onboarding@resend.dev>';
const MAX_PHOTO = 4 * 1024 * 1024;   /* Vercel accepts request bodies up to 4.5 MB */

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export default {
  async fetch(request) {
    if (request.method !== 'POST') return json(405, { error: 'POST only' });

    let form;
    try { form = await request.formData(); }
    catch { return json(400, { error: 'Could not read the form' }); }

    /* bots fill the hidden field, or submit faster than anyone can type: thank them and drop it */
    if (clean(form.get('website'), 200) || Number(form.get('elapsed') || 0) < 2500) return json(200, { ok: true });

    const kind = form.get('kind') === 'correction' ? 'correction' : 'nomination';
    const email = clean(form.get('email'), 200);
    const page = clean(form.get('page'), 500);
    if (email && !isEmail(email)) return json(400, { error: 'That email address does not look right' });

    const photo = form.get('photo');
    const hasPhoto = !!(photo && typeof photo === 'object' && photo.size);

    let subject, rows;
    if (kind === 'correction') {
      const person = clean(form.get('person'), 200);
      const correction = clean(form.get('correction'), 6000);
      /* a correction can be words, a better photo, or both */
      if (correction.length < 3 && !hasPhoto) return json(400, { error: 'Please say what we got wrong, or add a photo' });
      subject = `Correction: ${person || 'a page on the wall'}`;
      rows = [['Person', person], ['What we got wrong', correction], ['Source', clean(form.get('source'), 500)], ['Their email', email], ['Page', page]];
    } else {
      const name = clean(form.get('name'), 200);
      if (name.length < 2) return json(400, { error: 'Please give their name' });
      subject = `Carve a name: ${name}`;
      rows = [['Name', name], ['What they did', clean(form.get('desc'), 6000)], ['Link', clean(form.get('source'), 500)], ['Sender\'s email', email], ['Sent from', page]];
    }

    const attachments = [];
    if (hasPhoto) {
      if (!String(photo.type).startsWith('image/')) return json(400, { error: 'The photo must be an image' });
      if (photo.size > MAX_PHOTO) return json(413, { error: 'The photo is too large' });
      const name = String(photo.name || 'photo.jpg').replace(/[^\w.\- ]+/g, '_').slice(-80);
      attachments.push({ filename: name, content: Buffer.from(await photo.arrayBuffer()).toString('base64') });
    }

    const key = process.env.RESEND_API_KEY;
    if (!key) return json(503, { error: 'Submissions are not connected yet' });

    const filled = rows.filter(([, v]) => v);
    const text = filled.map(([k, v]) => `${k}:\n${v}`).join('\n\n') + (attachments.length ? '\n\nA photo is attached.' : '');
    const html = `<table cellpadding="8" style="border-collapse:collapse;font-family:Georgia,serif;font-size:15px">${
      filled.map(([k, v]) => `<tr><td style="vertical-align:top;color:#66645C;white-space:nowrap">${esc(k)}</td><td style="white-space:pre-wrap">${esc(v)}</td></tr>`).join('')
    }</table>${attachments.length ? '<p style="font-family:Georgia,serif;color:#66645C">A photo is attached.</p>' : ''}`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.SUBMIT_FROM || DEFAULT_FROM,
        to: [process.env.SUBMIT_TO || DEFAULT_TO],
        subject, text, html,
        ...(email ? { reply_to: email } : {}),
        ...(attachments.length ? { attachments } : {}),
      }),
    });
    if (!res.ok) {
      console.error('resend', res.status, await res.text().catch(() => ''));
      return json(502, { error: 'The message could not be sent just now' });
    }
    return json(200, { ok: true });
  },
};
