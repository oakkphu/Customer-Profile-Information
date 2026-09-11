'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || process.env.FRONTEND_PORT || 3230) || 3230;
const API_ORIGIN = (process.env.API_ORIGIN || 'http://127.0.0.1:3220').replace(/\/$/, '');
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function send(res, code, body, headers) {
  const h = Object.assign({ 'Cache-Control': 'no-store' }, headers || {});
  res.writeHead(code, h);
  res.end(body);
}

function proxyApi(req, res) {
  const target = new URL(req.url, API_ORIGIN);
  const headers = { ...req.headers, host: target.host };
  delete headers['accept-encoding'];

  const upstream = http.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || 80,
    path: target.pathname + target.search,
    method: req.method,
    headers,
  }, up => {
    const outHeaders = { ...up.headers };
    res.writeHead(up.statusCode || 502, outHeaders);
    up.pipe(res);
  });

  upstream.on('error', err => {
    console.error('API proxy error:', err.message);
    send(res, 502, JSON.stringify({ error: 'เชื่อมต่อ backend ไม่ได้ — ตรวจว่า API รันที่ ' + API_ORIGIN }), {
      'Content-Type': 'application/json; charset=utf-8',
    });
  });

  req.pipe(upstream);
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' || pathname === '/login' ? '/index.html' : pathname;
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) {
    send(res, 403, 'Forbidden');
    return;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    // SPA fallback
    const index = path.join(ROOT, 'index.html');
    send(res, 200, fs.readFileSync(index), { 'Content-Type': MIME['.html'] });
    return;
  }
  send(res, 200, fs.readFileSync(file), {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    proxyApi(req, res);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method Not Allowed');
    return;
  }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log('CSystem frontend at http://localhost:' + PORT);
  console.log('Proxy /api → ' + API_ORIGIN);
});
