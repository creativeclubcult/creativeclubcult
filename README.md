# Creative Club Cult — Maintenance Page

A minimal, type-focused "coming soon" page for **creativeclubcult.com**.
Static site, no framework. Dark monochrome, editorial with a little cult energy.

## Files

| File | Purpose |
|------|---------|
| `index.html` | The entire page — HTML, CSS, and JS inline |
| `logo-ccc.png` | CCC mark, cream on transparent (processed from the brand JPG) |
| `favicon.svg` | Italic serif "c", cream on black |
| `vercel.json` | Static config + cache/security headers |
| `robots.txt` | Allow all |
| `LOGO CCC.jpg` | Original hi-res source logo (git-ignored, not served) |

## Design

- **Palette** — bg `#0A0A0A`, text `#EFEBE4`
- **Fonts** — Instrument Serif (display headline + signature), Helvetica (utility, tight kerning)
- **Selection** — inverts to cream background / black text
- **Signature** — massive drifting `ccc · ccc` serif italic at the base, 6% opacity

## Deploy — Vercel via GitHub

1. Create a new GitHub repo and push this folder:
   ```bash
   git init
   git add .
   git commit -m "Maintenance page"
   git branch -M main
   git remote add origin git@github.com:<you>/creativeclubcult.git
   git push -u origin main
   ```
2. In **Vercel → Add New → Project**, import the repo.
3. Framework Preset: **Other** (no build step). Output is the repo root — leave build/output settings empty.
4. Deploy, then add the domain **creativeclubcult.com** under Project → Settings → Domains.

## Email capture

The "Notify me" form currently validates and confirms **client-side only** — nothing is
stored or sent yet. To collect real signups, point the form at a backend (Formspree,
Buttondown, ConvertKit, or a Vercel serverless function) — see the `<script>` block in
`index.html`.
