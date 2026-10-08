import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, checkConfig, ROOT } from './config.js';
import { getState, save } from './store.js';
import { loadProducts, groupOrders } from './products.js';
import { pollOnce, startPolling, applyProductOrders } from './poller.js';
import { notifyNewOrders } from './notify.js';
import * as mock from './mock.js';

const WEB = path.join(ROOT, 'web');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
function authorized(req) {
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return given && crypto.timingSafeEqual(digest(given), digest(config.appPassword));
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error('too large');
  }
  return raw ? JSON.parse(raw) : {};
}

function currentOrders() {
  const state = getState();
  return groupOrders(loadProducts(), Object.values(state.productOrders)).map((o) => ({
    ...o,
    packedAt: state.packed[o.orderId] || null,
  }));
}

async function handleApi(req, res, url) {
  if (!authorized(req)) {
    await new Promise((r) => setTimeout(r, 500)); // 비밀번호 무작위 대입 늦추기
    return send(res, 401, { error: '비밀번호가 필요합니다' });
  }
  const state = getState();

  if (req.method === 'GET' && url.pathname === '/api/orders') {
    return send(res, 200, {
      orders: currentOrders(),
      inquiries: Object.values(state.inquiries),
      lastPolledAt: state.lastPolledAt,
      mock: config.mock,
    });
  }

  const packed = url.pathname.match(/^\/api\/orders\/([^/]+)\/packed$/);
  if (req.method === 'POST' && packed) {
    const orderId = decodeURIComponent(packed[1]);
    const { packed: isPacked } = await readJson(req);
    if (isPacked) state.packed[orderId] = new Date().toISOString();
    else delete state.packed[orderId];
    save();
    return send(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/poll') {
    return send(res, 200, await pollOnce());
  }

  if (req.method === 'POST' && url.pathname === '/api/dev/fake-order' && config.mock) {
    const fresh = applyProductOrders(mock.fakeOrder());
    save();
    await notifyNewOrders(fresh);
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'not found' });
}

function serveStatic(req, res, url) {
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(WEB, rel));
  if (!file.startsWith(WEB + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    console.error('[http]', e);
    send(res, 500, { error: e.message });
  }
});

const problems = checkConfig();
if (problems.length) {
  console.error('설정을 확인하세요:\n - ' + problems.join('\n - '));
  process.exit(1);
}

server.listen(config.port, () => {
  console.log(`store-helper 실행 중: http://localhost:${config.port} ${config.mock ? '(가짜 데이터 모드)' : ''}`);
  startPolling();
});
