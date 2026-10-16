// Assembles the GitHub Pages site in _site/: the landing page (site/), the game build at /play/ and the
// single-file offline build at /download/. Run after `npm run build:single`.
import fs from 'node:fs';

const out = '_site';
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync('site', out, { recursive: true });
fs.cpSync('dist', `${out}/play`, { recursive: true });
fs.mkdirSync(`${out}/download`, { recursive: true });
fs.copyFileSync('dist-single/draw-the-map.html', `${out}/download/draw-the-map.html`);
console.log(`${out}/ ready: landing page, /play/, /download/draw-the-map.html`);
