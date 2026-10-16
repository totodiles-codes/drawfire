// Packs the Vite build (dist/) into one self-contained HTML file: dist-single/draw-the-map.html.
// The game has no asset files (sounds are synthesised, the Earth is procedural), so inlining the script, the
// stylesheet and the favicon is enough for it to run offline: double-click the file on Windows, macOS or Linux
// and it opens in the default browser.
import fs from 'node:fs';
import path from 'node:path';

const dist = 'dist';
const out = 'dist-single';
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const read = (href) => fs.readFileSync(path.join(dist, href.replace(/^\.?\//, '')), 'utf8');

html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/, (_, src) => {
    // a literal "</script" inside the bundle would end the inline tag early
    const js = read(src).replace(/<\/script/gi, '<\\/script');
    return `<script type="module">${js}</script>`;
});
html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/, (_, href) => `<style>${read(href)}</style>`);
html = html.replace(/<link rel="icon" type="image\/svg\+xml" href="([^"]+)" \/>/, (_, href) => {
    const svg = Buffer.from(read(href)).toString('base64');
    return `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${svg}" />`;
});
if (/(src|href)="\.?\/?assets\//.test(html)) throw new Error('build-single: an asset reference was left un-inlined');

fs.mkdirSync(out, { recursive: true });
const file = path.join(out, 'draw-the-map.html');
fs.writeFileSync(file, html);
console.log(`${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
