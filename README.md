# Rohingya Famous People

**Live at [people.rohingya.ro](https://people.rohingya.ro)**

An open archive of Rohingya lives, laid out as a wall of plaster-relief portraits you can drag around. Click a portrait to read the person's life; use **Search the wall** to search everyone by name, place, year, calling, or a plain question ("when was Jafar born?", "women poets", "born in Maungdaw", "died in 2009").

## Folders

| Folder / file | What it is |
|---|---|
| `content/people/*.md` | **One file per person.** This is where you write. |
| `content/people/_template.md` | A blank person to copy. Files starting with `_` are skipped. |
| `photos/` | Original photos, named after the person's file (`b-a-jafar.jpg`). |
| `reliefs/` | **Your finished plaster-relief images** (AI-made), named `b-a-jafar.png` / `.webp` / `.jpg`. These always win over the automatic ones. |
| `reliefs/auto/` | Reliefs made automatically from `photos/`. Don't edit; delete one to remake it. |
| `site.config.json` | Site name, web address, description, where "Carve a name" submissions go. |
| `src/` | The design (`style.css`), behaviour (`app.js`) and the mail function (`api/submit.js`). |
| `tools/` | The photo-to-relief tool and the social-card maker. |
| `dist/` | **The finished website.** Rebuilt every time; upload this folder. |

## Add a person

1. Copy `content/people/_template.md` to `content/people/their-name.md` (lowercase, dashes, no spaces). The file name becomes the page address: `/people/their-name/`.
2. Fill in the header and the sections. Dates can be a year (`1939`) or a full date (`1987-11-06`).
3. Put their photo in `photos/` and write its file name after `photo:`.
4. Build (below). A plaster relief is carved from the photo automatically.

If the automatic relief frames the face badly, add a `relief:` line to the header:

```
relief: cut-bottom=0.25 width=0.23
```

Every face is carved at the same size and height, so normally nothing is needed. `cut-bottom` ignores a caption or name banner printed across the bottom of the photo (0.25 = the bottom quarter); `width` narrows the bust to trim a bystander's shoulder (default 0.27). `zoom`, `dx` and `dy` exist for unusual photos but break the "all the same size" look, so use them sparingly.

## Build and preview

```bash
cd website
node build.mjs
python3 -m http.server 4791 --directory dist
```

Then open http://localhost:4791. Building needs Node 18 or newer. Carving reliefs needs a Mac (it uses the Mac's own Vision framework) and `cwebp` (`brew install webp`). Social cards need Python 3 with Pillow.

## Make proper relief portraits (the original site's look)

The automatic reliefs are stand-ins. The original site's portraits were made with an AI image model, one per person, from a reference photo. To make yours the same way:

1. Open an image model that can edit a photo you upload: ChatGPT (image generation), Google Gemini (image editing), Midjourney (with the photo as a character reference), or Flux Kontext.
2. Upload the person's clearest photo and use this prompt:

   > Turn the person in this photo into a white plaster bas-relief portrait carved into a flat plaster wall. Head and shoulders bust, centred, the face about a quarter of the image height, the bust ending in a softly rounded cut below the shoulders. Matte, unpainted, warm off-white plaster; the background is the same flat plaster wall, colour #DDDCD7. The relief rises only a few centimetres from the wall. Soft daylight from the upper left, gentle shadows falling to the lower right. Keep the person's real face, age, hairstyle, headwear, glasses and clothing, all carved in plaster. No colour, no text, no frame, no other objects. Square image, 1:1.

3. Generate a few and keep the one that looks most like the person. **Check the likeness against the photo**: AI models sometimes change faces, and this is an archive.
4. Save it as `reliefs/<their-file-name>.png` (for example `reliefs/b-a-jafar.png`) and build again.

Tips: keep one chat for all portraits so the style stays consistent; ask for "the same plaster, lighting and framing as the previous one"; and a plain background close to `#DDDCD7` blends into the wall best. Each portrait sits in its tile at 80% size; add `fit: 0.9 0 -2` (size, left/right %, up/down %) to the header to adjust one.

## Before going live

- Set `"url"` in `site.config.json` to the real web address. Sitemaps, Google and AI crawlers use it.
- **Carve a name** (with an optional photo) and **Submit a correction** are sent by the site's own small mail function, `dist/api/submit.js`, to the address in `site.config.json` → `submissions.to` (ab@rohingya.ro). It needs [Vercel](https://vercel.com) and a free [Resend](https://resend.com) account:
  1. Sign up at resend.com and create an API key. Open the account with ab@rohingya.ro: until you verify your own domain at Resend, its test sender only delivers to the account's own address.
  2. In the Vercel project, open Settings → Environment Variables and add `RESEND_API_KEY` with that key. Optionally add `SUBMIT_FROM` (for example `Rohingya Famous People <wall@rohingya.ro>`) once rohingya.ro is verified at Resend.
  3. Deploy, then send one test nomination from the live site.

  Until then (and on the local preview), the forms fall back to opening the visitor's email app with the message already written, addressed to ab@rohingya.ro.
## Publishing

The site lives at **https://people.rohingya.ro**. The code is on GitHub at [abahziz0/rohingya-famous-people](https://github.com/abahziz0/rohingya-famous-people), and Vercel publishes it automatically.

Vercel does not build anything: its project's Root Directory is `dist/`, and it serves that folder exactly as `node build.mjs` made it on the Mac (the relief carving and social cards need macOS tools). So to publish a change:

```bash
cd website
node build.mjs
git add -A
git commit -m "Describe the change"
git push
```

A minute after the push the live site is updated. Vercel also runs the mail function from `dist/api/submit.js`.
- Register the site in Google Search Console and Bing Webmaster Tools and submit `https://your-address/sitemap.xml`.

## What search engines and AI assistants get

Every page is complete HTML: names, dates, places, timeline, sources and the full biography, with no script needed to read it. Each person page also carries Person data in schema.org format (birth and death dates and places, other names, role), Open Graph cards for social sharing, and a canonical address.

| Address | For |
|---|---|
| `/people/<name>/` | The person's page |
| `/people/<name>/index.md` | The same, as plain Markdown, for AI tools |
| `/people/` | An index of every name |
| `/sitemap.xml` | Search engines |
| `/robots.txt` | Welcomes search engines and AI crawlers (GPTBot, ClaudeBot, Google-Extended, PerplexityBot and others) |
| `/llms.txt`, `/llms-full.txt` | AI assistants: a guide to the site, and every biography in one file |
| `/data/people.json` | Open data |
| `/?q=jafar` | Opens the wall's search with that query |
