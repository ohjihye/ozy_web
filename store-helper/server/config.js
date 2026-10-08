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
  appPassword: env.APP_PASSWORD || '',
  appUrl: env.APP_URL || `http://localhost:${env.PORT || 8080}`,
  mock: env.MOCK === '1',
  pollSeconds: Math.max(30, Number(env.POLL_SECONDS || 60)),
  dataDir: path.join(ROOT, 'data'),
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

export function checkConfig() {
  const problems = [];
  if (!config.appPassword || config.appPassword === 'change-me') problems.push('APP_PASSWORD 를 설정하세요');
  if (!config.mock && (!config.naver.clientId || !config.naver.clientSecret))
    problems.push('NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 이 필요합니다 (또는 MOCK=1)');
  if (config.notify === 'alimtalk') {
    const s = config.solapi;
    if (!s.apiKey || !s.apiSecret || !s.pfId || !s.from || !s.to.length)
      problems.push('알림톡 설정(SOLAPI_*, NOTIFY_TO)이 비어 있습니다');
  }
  return problems;
}
