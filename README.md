# Argon Website

The website for Argon, a Windows command deck for running coding agents side by side.
Static HTML, CSS and JS, deployed with GitHub Pages (same setup as the Chlorine site).

## Pages
- **Home** — `index.html` (live board animation + four interactive demos)
- **Features** — `features.html`
- **Download** — `download.html` (run from source now; installer marked "coming soon")
- **Transparency** — `transparency.html`
- **404** — `404.html`

Shared assets: `assets/site.css` (styles and motion), `assets/site.js` (theme, accent
personalization, navigation, scroll reveals and the demos) and `assets/argon-icon.svg`.

Live at https://ophidianp.github.io/argon/ (deployed from the `argon-website` branch).

## Still to do
- The download page tells people to clone `https://github.com/ophidianp/argon`. The app's
  source still needs to go on that repo's `main` branch.
- Update the installer card once a `.exe` release exists.

## Preview locally
```
python -m http.server 8080
```
then open http://localhost:8080.
