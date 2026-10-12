import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, secureCookie } from './config.js';
import { getState } from './store.js';

// ── 로그인 토큰 ─────────────────────────────
// 비밀번호는 로그인할 때 한 번만 보내고, 그 뒤로는 서명된 토큰을 HttpOnly 쿠키로 주고받습니다.
// 토큰 서명 키 = 서버 비밀값 + APP_PASSWORD 이므로, 비밀번호를 바꾸면 모든 기기가 로그아웃됩니다.
// "모든 기기 로그아웃"은 sessionVersion 을 올려서 기존 토큰을 무효로 만듭니다.

export const COOKIE = 'sh_session';
export const TOKEN_DAYS = 30;

let secret = null;
function serverSecret() {
  if (secret) return secret;
  const file = path.join(config.dataDir, 'secret');
  try {
    secret = fs.readFileSync(file, 'utf8').trim();
  } catch {
    secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, secret, { mode: 0o600 });
  }
  return secret;
}

const signingKey = () => crypto.createHmac('sha256', serverSecret()).update(config.appPassword).digest();
const sign = (payload) => crypto.createHmac('sha256', signingKey()).update(payload).digest();
const sessionVersion = () => getState().sessionVersion || 0;

export function issueToken(now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ exp: now + TOKEN_DAYS * 864e5, v: sessionVersion() })).toString('base64url');
  return `${payload}.${sign(payload).toString('base64url')}`;
}

export function verifyToken(token, now = Date.now()) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return false;
  const expected = sign(payload);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
  try {
    const { exp, v } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return exp > now && v === sessionVersion();
  } catch {
    return false;
  }
}

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
export const checkPassword = (pw) => crypto.timingSafeEqual(digest(pw), digest(config.appPassword));

export function readCookie(req, name = COOKIE) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return '';
}

export function sessionCookie(token) {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Strict', secureCookie() ? 'Secure' : ''].filter(Boolean);
  return token
    ? `${COOKIE}=${token}; Max-Age=${TOKEN_DAYS * 86400}; ${attrs.join('; ')}`
    : `${COOKIE}=; Max-Age=0; ${attrs.join('; ')}`;
}

// ── 로그인 실패 잠금 ───────────────────────────
// IP별로 15분 안에 5번 틀리면 15분 잠급니다. 여러 IP에서 한꺼번에 시도하는 경우를 막으려고
// 전체 실패가 1시간에 30번을 넘으면 모든 로그인을 15분 잠급니다.
export const MAX_FAILS = 5;
export const GLOBAL_MAX_FAILS = 30;
const WINDOW = 15 * 60 * 1000;
const LOCK = 15 * 60 * 1000;
const fails = new Map(); // ip → { count, first, lockedUntil }
let global = { count: 0, first: 0, lockedUntil: 0 };

export function lockedSeconds(ip, now = Date.now()) {
  const until = Math.max(fails.get(ip)?.lockedUntil || 0, global.lockedUntil);
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

export function recordFailure(ip, now = Date.now()) {
  let f = fails.get(ip);
  if (!f || now - f.first > WINDOW) f = { count: 0, first: now, lockedUntil: 0 };
  f.count++;
  if (f.count >= MAX_FAILS) f.lockedUntil = now + LOCK;
  fails.set(ip, f);

  if (now - global.first > 60 * 60 * 1000) global = { count: 0, first: now, lockedUntil: 0 };
  global.count++;
  if (global.count >= GLOBAL_MAX_FAILS) {
    global.lockedUntil = now + LOCK;
    console.warn('[auth] 로그인 실패가 너무 많아 모든 로그인을 15분 잠급니다');
  }
  if (fails.size > 10_000) fails.clear(); // 메모리 보호
}

export function recordSuccess(ip) {
  fails.delete(ip);
}

export function resetLockouts() {
  fails.clear();
  global = { count: 0, first: 0, lockedUntil: 0 };
}

// Caddy 뒤에서는 Caddy가 붙여 준 X-Forwarded-For 의 마지막 값이 실제 접속 IP입니다.
// 바깥에서 직접 들어온 요청의 헤더는 위조될 수 있으므로 믿지 않습니다.
export function clientIp(req) {
  const remote = req.socket?.remoteAddress || '';
  const fromLocal = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote);
  if (config.trustProxy && fromLocal) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1];
  }
  return remote;
}
