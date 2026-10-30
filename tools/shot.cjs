// Usage: node tools/shot.cjs <genId> <out.png> [seconds=2] [paramsJSON]
// Serves the repo, opens the app, selects a generator, applies params, lets it run, saves the canvas.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const [, , id, out, secs = '2', json = '{}'] = process.argv;
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0].split('#')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(0, async () => {
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://localhost:${port}/#${id}`);
  await page.waitForFunction(() => window.sawmill);
  await page.evaluate(([id, params]) => {
    const { app, select } = window.sawmill;
    select(id);
    Object.assign(app.env.params, params);
    app.dirty = true;
  }, [id, JSON.parse(json)]);
  await page.waitForTimeout(parseFloat(secs) * 1000 + 300);
  const data = await page.evaluate(() => document.querySelector('#stage').toDataURL('image/png'));
  fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
  if (process.argv.includes('--ui')) await page.screenshot({ path: out.replace(/\.png$/, '-ui.png') });
  if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
  else console.log('ok');
  await browser.close();
  server.close();
});
