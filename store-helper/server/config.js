import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// .env 파일을 읽어 process.env 에 채웁니다 (이미 설정된 값은 덮어쓰지 않음)
function loadDotenv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotenv(path.join(ROOT, '.env'));

const env = process.env;

export const config = {
  port: Number(env.PORT || 8080),
  // 기본은 이 컴퓨터 안에서만 접속 가능. 바깥에서는 Caddy(HTTPS)를 거쳐서 들어옵니다.
  host: env.HOST || '127.0.0.1',
  // Caddy 뒤에서 실행할 때 1: 접속한 사람의 실제 IP를 X-Forwarded-For 에서 읽습니다
  trustProxy: env.TRUST_PROXY === '1',
  appPassword: env.APP_PASSWORD || '',
  appUrl: env.APP_URL || `http://localhost:${env.PORT || 8080}`,
  mock: env.MOCK === '1',
  pollSeconds: Math.max(30, Number(env.POLL_SECONDS || 60)),
  dataDir: env.DATA_DIR || path.join(ROOT, 'data'),
  naver: {
    clientId: env.NAVER_CLIENT_ID || '',
    clientSecret: env.NAVER_CLIENT_SECRET || '',
  },
  notify: env.NOTIFY || 'console',
  solapi: {
    apiKey: env.SOLAPI_API_KEY || '',
    apiSecret: env.SOLAPI_API_SECRET || '',
    pfId: env.SOLAPI_PF_ID || '',
    templateOrder: env.SOLAPI_TEMPLATE_ORDER || '',
    templateInquiry: env.SOLAPI_TEMPLATE_INQUIRY || '',
    from: env.SOLAPI_FROM || '',
    to: (env.NOTIFY_TO || '').split(',').map((s) => s.trim()).filter(Boolean),
  },
};

export const MIN_PASSWORD = 12;

// 실행을 막아야 하는 문제 목록
export function checkConfig() {
  const problems = [];
  if (!config.appPassword || config.appPassword === 'change-me') problems.push('APP_PASSWORD 를 설정하세요');
  else if (!config.mock && config.appPassword.length < MIN_PASSWORD)
    problems.push(`APP_PASSWORD 는 ${MIN_PASSWORD}자 이상으로 정하세요`);
  if (!config.mock && (!config.naver.clientId || !config.naver.clientSecret))
    problems.push('연결할 스토어가 없습니다. NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 을 넣으세요 (또는 MOCK=1)');
  if (config.notify === 'alimtalk') {
    const s = config.solapi;
    if (!s.apiKey || !s.apiSecret || !s.pfId || !s.from || !s.to.length)
      problems.push('알림톡 설정(SOLAPI_*, NOTIFY_TO)이 비어 있습니다');
  }
  return problems;
}

// 실행은 하되 경고할 문제 목록
export function configWarnings() {
  const warnings = [];
  if (!config.mock && !config.appUrl.startsWith('https://'))
    warnings.push('APP_URL 이 https:// 가 아닙니다. HTTPS 없이 실제 주문 정보를 다루지 마세요 (README의 HTTPS 설정 참고)');
  if (config.host !== '127.0.0.1' && config.host !== 'localhost')
    warnings.push(`HOST=${config.host}: 서버가 바깥에 직접 열려 있습니다. Caddy 뒤에서만 쓰는 것을 권합니다`);
  return warnings;
}

// 로그인 쿠키에 Secure 를 붙일지 (HTTPS 로 운영할 때)
export const secureCookie = () => config.appUrl.startsWith('https://');
