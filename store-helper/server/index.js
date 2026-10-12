import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, checkConfig, configWarnings, ROOT } from './config.js';
import { getState, save, resetState } from './store.js';
import { loadProducts, groupOrders } from './products.js';
import { pollOnce, startPolling, applyProductOrders, currentInquiries } from './poller.js';
import { attachDetails } from './details.js';
import { notifyNewOrders } from './notify.js';
import * as auth from './auth.js';
import * as naver from './naver.js';
import * as mock from './mock.js';

const WEB = path.join(ROOT, 'web');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};

// 모든 응답에 붙이는 보안 헤더
const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, data, headers = {}) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new HttpError(413, '요청이 너무 큽니다');
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, '요청 형식이 잘못됐습니다');
  }
}

async function currentOrders() {
  const state = getState();
  const { list, error } = await attachDetails(
    Object.values(state.productOrders),
    config.mock ? null : naver.productOrderDetails,
  );
  const orders = groupOrders(loadProducts(), list).map((o) => ({ ...o, packedAt: state.packed[o.orderId] || null }));
  return { orders, detailsError: Boolean(error) };
}

async function login(req, res) {
  const ip = auth.clientIp(req);
  const wait = auth.lockedSeconds(ip);
  if (wait) {
    return send(res, 429, { error: `잠시 잠겼어요. ${Math.ceil(wait / 60)}분 뒤에 다시 시도하세요.`, retryAfter: wait },
      { 'Retry-After': String(wait) });
  }
  const { password } = await readJson(req);
  if (typeof password !== 'string' || !auth.checkPassword(password)) {
    auth.recordFailure(ip);
    const locked = auth.lockedSeconds(ip);
    console.warn(`[auth] 로그인 실패 (${ip})${locked ? ' → 잠금' : ''}`);
    return send(res, 401, { error: '비밀번호가 맞지 않아요', locked: Boolean(locked) });
  }
  auth.recordSuccess(ip);
  return send(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(auth.issueToken()) });
}

async function handleApi(req, res, url) {
  // 다른 사이트가 몰래 요청을 보내지 못하게, 이 앱이 붙이는 헤더가 있어야만 받습니다
  if (req.method !== 'GET' && req.headers['x-app'] !== '1') throw new HttpError(403, '허용되지 않은 요청입니다');

  if (req.method === 'POST' && url.pathname === '/api/login') return login(req, res);
  if (req.method === 'POST' && url.pathname === '/api/logout') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(null) });
  }

  if (!auth.verifyToken(auth.readCookie(req))) throw new HttpError(401, '로그인이 필요합니다');
  const state = getState();

  if (req.method === 'GET' && url.pathname === '/api/orders') {
    const { orders, detailsError } = await currentOrders();
    return send(res, 200, {
      orders,
      detailsError,
      inquiries: currentInquiries(),
      lastPolledAt: state.lastPolledAt,
      mock: config.mock,
    });
  }

  const packed = url.pathname.match(/^\/api\/orders\/([^/]+)\/packed$/);
  if (req.method === 'POST' && packed) {
    const orderId = decodeURIComponent(packed[1]);
    if (!Object.values(state.productOrders).some((po) => po.orderId === orderId)) throw new HttpError(404, '없는 주문입니다');
    const { packed: isPacked } = await readJson(req);
    if (isPacked) state.packed[orderId] = new Date().toISOString();
    else delete state.packed[orderId];
    save();
    return send(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/poll') {
    return send(res, 200, await pollOnce());
  }

  if (req.method === 'POST' && url.pathname === '/api/logout-all') {
    state.sessionVersion = (state.sessionVersion || 0) + 1;
    save();
    console.log('[auth] 모든 기기를 로그아웃했습니다');
    return send(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(null) });
  }

  if (req.method === 'POST' && url.pathname === '/api/dev/fake-order' && config.mock) {
    const fresh = applyProductOrders(mock.fakeOrder());
    save();
    await notifyNewOrders(fresh);
    return send(res, 200, { ok: true });
  }

  throw new HttpError(404, '없는 주소입니다');
}

function serveStatic(req, res, url) {
  let rel;
  try {
    rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  } catch {
    rel = '';
  }
  const file = path.normalize(path.join(WEB, rel));
  if (!rel || !file.startsWith(WEB + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, SECURITY_HEADERS);
    return res.end('not found');
  }
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      return serveStatic(req, res, url);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error('[http]', e);
      send(res, 500, { error: '서버 오류가 났어요. 잠시 후 다시 시도하세요.' }); // 내부 오류 내용은 밖으로 보내지 않음
    }
  });
}

function start() {
  const problems = checkConfig();
  if (problems.length) {
    console.error('설정을 확인하세요:\n - ' + problems.join('\n - '));
    process.exit(1);
  }
  for (const w of configWarnings()) console.warn(`⚠️  ${w}`);
  if (config.mock) resetState(); // 가짜 데이터는 매번 새로 만듭니다

  createServer().listen(config.port, config.host, () => {
    console.log(`store-helper 실행 중: http://${config.host}:${config.port} ${config.mock ? '(가짜 데이터 모드)' : ''}`);
    startPolling();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) start();
