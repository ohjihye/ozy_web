import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// 서버 상태를 data/state.json 에 저장합니다. (data/ 는 .gitignore 처리됨)
// 고객 정보는 발송 전 주문에 대해서만 보관하고, 발송/취소되면 지웁니다.
const file = path.join(config.dataDir, 'state.json');

const empty = () => ({
  lastPolledAt: null,
  productOrders: {}, // productOrderId → 정규화된 상품주문
  seenProductOrders: {}, // productOrderId → 처음 본 시각 (알림 중복 방지)
  packed: {}, // orderId → 포장 완료 시각
  inquiries: {}, // id → 미답변 문의
  seenInquiries: {},
});

let state = load();

function load() {
  try {
    return { ...empty(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return empty();
  }
}

export function getState() {
  return state;
}

export function save() {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// 오래된 "본 적 있음" 기록 정리 (30일)
export function prune() {
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  for (const key of ['seenProductOrders', 'seenInquiries']) {
    for (const [id, t] of Object.entries(state[key])) if (Date.parse(t) < cutoff) delete state[key][id];
  }
  for (const orderId of Object.keys(state.packed)) {
    if (!Object.values(state.productOrders).some((po) => po.orderId === orderId)) delete state.packed[orderId];
  }
}
