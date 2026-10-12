// 보안 동작을 실제 서버를 띄워서 확인합니다 (가짜 데이터 모드, 임시 폴더 사용)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-sec-'));
Object.assign(process.env, {
  DATA_DIR: dataDir, MOCK: '1', APP_PASSWORD: 'correct-horse-battery', TRUST_PROXY: '1', NOTIFY: 'console',
});
const { createServer } = await import('../server/index.js');
const { pollOnce } = await import('../server/poller.js');
const auth = await import('../server/auth.js');
const { config } = await import('../server/config.js');

let server, base;
before(async () => {
  console.log = () => {}; // 알림 출력 숨김
  await pollOnce(); // 가짜 주문 2건 생성
  server = createServer().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

let ipSeq = 0;
const newIp = () => `203.0.113.${++ipSeq}`;
const post = (p, body, { ip = newIp(), cookie = '', app = true } = {}) =>
  fetch(base + p, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'X-Forwarded-For': ip,
      ...(app ? { 'X-App': '1' } : {}), ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body || {}),
  });
const get = (p, cookie = '') => fetch(base + p, { headers: cookie ? { Cookie: cookie } : {} });
const cookieOf = (res) => (res.headers.get('set-cookie') || '').split(';')[0];
async function login() {
  const res = await post('/api/login', { password: 'correct-horse-battery' });
  assert.equal(res.status, 200);
  return cookieOf(res);
}

test('로그인하지 않으면 주문을 볼 수 없다', async () => {
  assert.equal((await get('/api/orders')).status, 401);
  assert.equal((await get('/api/orders', 'sh_session=garbage.value')).status, 401);
});

test('앱 헤더가 없는 POST 는 거부한다 (다른 사이트에서 보내는 요청 차단)', async () => {
  const res = await post('/api/login', { password: 'correct-horse-battery' }, { app: false });
  assert.equal(res.status, 403);
});

test('로그인하면 HttpOnly 쿠키를 받고 주문을 볼 수 있다', async () => {
  const res = await post('/api/login', { password: 'correct-horse-battery' });
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const orders = await (await get('/api/orders', cookieOf(res))).json();
  assert.equal(orders.orders.length, 2);
  assert.ok(orders.orders[0].recipient.name, '메모리에 있는 받는 분 정보가 붙어 있어야 함');
});

test('같은 IP에서 5번 틀리면 잠기고, 맞는 비밀번호도 거부한다', async () => {
  auth.resetLockouts();
  const ip = newIp();
  for (let i = 1; i <= 5; i++) {
    const res = await post('/api/login', { password: `wrong-${i}` }, { ip });
    assert.equal(res.status, 401);
    if (i === 5) assert.equal((await res.json()).locked, true);
  }
  const blocked = await post('/api/login', { password: 'correct-horse-battery' }, { ip });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  // 다른 IP는 영향 없음
  assert.equal((await post('/api/login', { password: 'correct-horse-battery' })).status, 200);
});

test('여러 IP에서 계속 틀리면 전체 로그인을 잠근다', async () => {
  auth.resetLockouts();
  for (let i = 0; i < auth.GLOBAL_MAX_FAILS; i++) await post('/api/login', { password: 'nope' });
  assert.equal((await post('/api/login', { password: 'correct-horse-battery' })).status, 429);
  auth.resetLockouts();
});

test('디스크에는 고객 개인정보와 문의 내용이 저장되지 않는다', async () => {
  const cookie = await login();
  const { orders } = await (await get('/api/orders', cookie)).json();
  const saved = fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8');
  for (const o of orders) {
    assert.ok(!saved.includes(o.recipient.name), '이름이 저장되면 안 됨');
    assert.ok(!saved.includes(o.recipient.phone), '전화번호가 저장되면 안 됨');
    assert.ok(!saved.includes(o.recipient.address1), '주소가 저장되면 안 됨');
  }
  assert.ok(!saved.includes('recipient'));
  assert.ok(!saved.includes('유통기한'), '문의 내용이 저장되면 안 됨');
  const mode = fs.statSync(path.join(dataDir, 'state.json')).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('없는 주문은 포장 완료로 표시할 수 없다', async () => {
  const cookie = await login();
  assert.equal((await post('/api/orders/NOPE/packed', { packed: true }, { cookie })).status, 404);
  const { orders } = await (await get('/api/orders', cookie)).json();
  assert.equal((await post(`/api/orders/${orders[0].orderId}/packed`, { packed: true }, { cookie })).status, 200);
});

test('모든 기기 로그아웃 후에는 예전 쿠키가 통하지 않는다', async () => {
  const phoneA = await login();
  const phoneB = await login();
  assert.equal((await post('/api/logout-all', {}, { cookie: phoneA })).status, 200);
  assert.equal((await get('/api/orders', phoneA)).status, 401);
  assert.equal((await get('/api/orders', phoneB)).status, 401);
  assert.equal((await get('/api/orders', await login())).status, 200);
});

test('비밀번호를 바꾸면 기존 토큰이 무효가 된다', () => {
  const token = auth.issueToken();
  assert.ok(auth.verifyToken(token));
  const old = config.appPassword;
  config.appPassword = 'a-brand-new-password';
  assert.equal(auth.verifyToken(token), false);
  config.appPassword = old;
  assert.ok(auth.verifyToken(token));
});

test('토큰은 위조하거나 기한이 지나면 무효다', () => {
  const token = auth.issueToken();
  const [payload, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ exp: Date.now() + 1e12, v: 99 })).toString('base64url');
  assert.equal(auth.verifyToken(`${forged}.${sig}`), false);
  assert.equal(auth.verifyToken(`${payload}.${sig.slice(0, -2)}xx`), false);
  assert.equal(auth.verifyToken(token, Date.now() + (auth.TOKEN_DAYS + 1) * 864e5), false);
});

test('보안 헤더가 붙고, 웹 폴더 밖 파일은 열 수 없다', async () => {
  const res = await get('/');
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  for (const p of ['/../.env', '/%2e%2e/.env', '/..%2f.env', '/%E0%A4%A']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 404, p);
  }
});

test('잘못된 요청에는 짧은 안내만 돌려준다', async () => {
  const cookie = await login();
  const { orders } = await (await get('/api/orders', cookie)).json();
  const res = await fetch(`${base}/api/orders/${orders[0].orderId}/packed`, {
    method: 'POST', headers: { 'X-App': '1', Cookie: cookie, 'Content-Type': 'application/json' }, body: '{not json',
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: '요청 형식이 잘못됐습니다' });
});
