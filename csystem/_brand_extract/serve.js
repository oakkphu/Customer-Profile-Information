'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'frontend', 'assets', 'brand-preview');
http.createServer((req, res) => {
  let u = decodeURIComponent((req.url || '/').split('?')[0]);
  if (u === '/') u = '/Brand-Guideline.pdf';
  const f = path.normalize(path.join(root, u.replace(/^\//, '')));
  if (!f.startsWith(root) || !fs.existsSync(f)) {
    res.writeHead(404); res.end('not found'); return;
  }
  const ext = path.extname(f).toLowerCase();
  const ct = ext === '.pdf' ? 'application/pdf' : (ext === '.png' ? 'image/png' : 'application/octet-stream');
  res.writeHead(200, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*' });
  fs.createReadStream(f).pipe(res);
}).listen(3456, () => console.log('ready on 3456'));
