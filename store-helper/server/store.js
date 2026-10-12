import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { withoutPersonal } from './details.js';

// 서버 상태를 data/state.json 에 저장합니다. (data/ 는 .gitignore 처리됨)
// 고객 개인정보와 문의 내용은 저장하지 않습니다 (details.js 의 메모리 캐시에만 둠).
const file = () => path.join(config.dataDir, 'state.json');

const empty = () => ({
  lastPolledAt: null,
  productOrders: {}, // productOrderId → 상품주문 (개인정보 제외)
  seenProductOrders: {}, // productOrderId → 처음 본 시각 (알림 중복 방지)
  packed: {}, // orderId → 포장 완료 시각
  seenInquiries: {},
  sessionVersion: 0, // 올리면 모든 기기가 로그아웃됩니다
});

let state = null;

function load() {
  let loaded;
  try {
    loaded = { ...empty(), ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    return empty();
  }
  // 예전 버전이 저장한 개인정보와 문의 내용을 지웁니다
  const hadPersonal = 'inquiries' in loaded || Object.values(loaded.productOrders).some((po) => 'recipient' in po);
  delete loaded.inquiries;
  for (const [id, po] of Object.entries(loaded.productOrders)) loaded.productOrders[id] = withoutPersonal(po);
  if (hadPersonal) {
    state = loaded;
    save();
    console.log('[store] 예전에 저장된 고객 정보를 지웠습니다');
  }
  return loaded;
}

export function getState() {
  state ||= load();
  return state;
}

export function save() {
  const s = getState();
  const safe = {
    ...s,
    productOrders: Object.fromEntries(Object.entries(s.productOrders).map(([id, po]) => [id, withoutPersonal(po)])),
  };
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const tmp = `${file()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(safe, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file());
}

// 오래된 "본 적 있음" 기록 정리 (30일)
export function prune() {
  const s = getState();
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  for (const key of ['seenProductOrders', 'seenInquiries']) {
    for (const [id, t] of Object.entries(s[key])) if (Date.parse(t) < cutoff) delete s[key][id];
  }
  for (const orderId of Object.keys(s.packed)) {
    if (!Object.values(s.productOrders).some((po) => po.orderId === orderId)) delete s.packed[orderId];
  }
}

// 가짜 데이터 모드에서 이전 실행의 상태를 버릴 때 씁니다
export function resetState() {
  state = null;
  try { fs.rmSync(file()); } catch { /* 없음 */ }
}
