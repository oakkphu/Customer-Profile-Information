'use strict';
/**
 * รัน CSystem ทั้งระบบด้วยคำสั่งเดียว:
 *   npm start
 *
 * โหมด Docker / รวมพอร์ต: รัน backend ตัวเดียว (เสิร์ฟ UI + API)
 * โหมด dev แยกพอร์ต: ตั้ง SPLIT_PORTS=1 แล้วจะเปิด UI proxy แยก
 */
const { spawn, execFileSync } = require('child_process');
const http = require('http');
const path = require('path');

const root = __dirname;
const DOCKER = process.env.DOCKER === '1';
const SPLIT = process.env.SPLIT_PORTS === '1' && !DOCKER;
const API_PORT = Number(process.env.APP_PORT || 3220) || 3220;
const UI_PORT = Number(process.env.PORT || process.env.FRONTEND_PORT || 3230) || 3230;
const kids = [];
let shuttingDown = false;

function prefixPipe(stream, tag, target) {
  let buf = '';
  stream.on('data', chunk => {
    buf += chunk.toString();
    const parts = buf.split(/\r?\n/);
    buf = parts.pop() || '';
    for (const line of parts) {
      if (line.length) target.write('[' + tag + '] ' + line + '\n');
    }
  });
  stream.on('end', () => {
    if (buf.length) target.write('[' + tag + '] ' + buf + '\n');
  });
}

function pidsOnPort(port) {
  const pids = new Set();
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
      const re = new RegExp('(?:TCP|UDP)\\s+\\S+:' + port + '\\s+\\S+\\s+LISTENING\\s+(\\d+)', 'gi');
      let m;
      while ((m = re.exec(out))) {
        const pid = Number(m[1]);
        if (pid > 0) pids.add(pid);
      }
    } else {
      const out = execFileSync('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      out.split(/\s+/).forEach(s => {
        const pid = Number(s);
        if (pid > 0) pids.add(pid);
      });
    }
  } catch (_) {}
  return [...pids];
}

function freePort(port) {
  const pids = pidsOnPort(port);
  for (const pid of pids) {
    if (pid === process.pid) continue;
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } else {
        process.kill(pid, 'SIGTERM');
      }
      console.log('  ปลดพอร์ต ' + port + ' (PID ' + pid + ')');
    } catch (_) {}
  }
}

function run(tag, cwd, script, envExtra) {
  const child = spawn(process.execPath, [script], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, envExtra || {}),
    windowsHide: true,
  });
  prefixPipe(child.stdout, tag, process.stdout);
  prefixPipe(child.stderr, tag, process.stderr);
  child.on('exit', code => {
    if (shuttingDown) return;
    console.log('[' + tag + '] หยุดทำงาน (code ' + code + ') — ปิดทั้งระบบ');
    shutdown(code || 0);
  });
  kids.push(child);
  return child;
}

function killTree(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      child.kill('SIGTERM');
    }
  } catch (_) {}
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  kids.forEach(killTree);
  setTimeout(() => process.exit(code), 400);
}

function waitHealth(url, tries) {
  return new Promise(resolve => {
    let left = tries;
    const tick = () => {
      const req = http.get(url, res => {
        res.resume();
        if (res.statusCode === 200) return resolve(true);
        if (--left <= 0) return resolve(false);
        setTimeout(tick, 250);
      });
      req.on('error', () => {
        if (--left <= 0) return resolve(false);
        setTimeout(tick, 250);
      });
    };
    tick();
  });
}

console.log('');
console.log('  CSystem — เริ่มต้นทั้งระบบ');
console.log('  -----------------------------------------');

if (SPLIT) {
  freePort(API_PORT);
  freePort(UI_PORT);
  run('api', path.join(root, 'backend'), 'server.js', {
    PORT: String(API_PORT),
    APP_PORT: String(API_PORT),
    SERVE_FRONTEND: '0',
  });
  run('ui', path.join(root, 'frontend'), 'server.js', {
    PORT: String(UI_PORT),
    FRONTEND_PORT: String(UI_PORT),
    API_ORIGIN: 'http://127.0.0.1:' + API_PORT,
  });
  waitHealth('http://127.0.0.1:' + API_PORT + '/api/health', 40).then(ok => {
    console.log('');
    console.log(ok ? '  Backend  พร้อม  http://localhost:' + API_PORT : '  Backend  ยังไม่ตอบ health');
    console.log('  Frontend พร้อม  http://localhost:' + UI_PORT + '  ← เปิดที่นี่');
    console.log('');
  });
} else {
  // ค่าเริ่มต้น: พอร์ตเดียว (UI + API) — เหมาะกับ Docker / Coolify / ใช้งานปกติ
  if (!DOCKER) freePort(UI_PORT);
  const listenPort = DOCKER ? (Number(process.env.PORT) || 3000) : UI_PORT;
  run('app', path.join(root, 'backend'), 'server.js', {
    PORT: String(listenPort),
    HOST: process.env.HOST || '0.0.0.0',
    SERVE_FRONTEND: '1',
    FRONTEND_ROOT: path.join(root, 'frontend'),
  });
  waitHealth('http://127.0.0.1:' + listenPort + '/api/health', 40).then(ok => {
    console.log('');
    console.log(ok ? '  พร้อมแล้ว  http://localhost:' + listenPort + '  (UI + API)' : '  ยังไม่ตอบ health — ตรวจ .env / DB');
    console.log('  กด Ctrl+C เพื่อหยุด');
    console.log('');
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
