import { config } from './config.js';

// 고객 개인정보(받는 분 이름·주소·연락처, 배송메모)는 디스크에 저장하지 않고 메모리에만 잠깐 둡니다.
// 서버가 꺼지거나 10분이 지나면 사라지고, 화면에서 필요할 때 네이버에서 다시 조회합니다.
const TTL = 10 * 60 * 1000;
const cache = new Map(); // productOrderId → { recipient, memo, at }

export const PERSONAL_FIELDS = ['recipient', 'memo'];

// 디스크에 저장해도 되는 부분만 남깁니다
export function withoutPersonal(po) {
  const copy = { ...po };
  for (const k of PERSONAL_FIELDS) delete copy[k];
  return copy;
}

export function remember(po, now = Date.now()) {
  cache.set(po.productOrderId, { recipient: po.recipient, memo: po.memo || '', at: now });
}

export function forget(productOrderId) {
  cache.delete(productOrderId);
}

const fresh = (entry, now) => entry && (config.mock || now - entry.at < TTL);

// 상품주문 목록에 개인정보를 붙입니다. 캐시에 없으면 fetchDetails(ids)로 다시 조회합니다.
// 조회에 실패하면 recipient: null 로 돌려주고, 화면에서 "불러오지 못했어요"를 보여줍니다.
export async function attachDetails(productOrders, fetchDetails, now = Date.now()) {
  for (const [id, entry] of cache) if (!fresh(entry, now)) cache.delete(id);
  const missing = productOrders.filter((po) => !cache.has(po.productOrderId)).map((po) => po.productOrderId);
  let error = null;
  if (missing.length && fetchDetails) {
    try {
      for (const d of await fetchDetails(missing)) remember(d, now);
    } catch (e) {
      error = e.message;
      console.warn('[details] 받는 분 정보 조회 실패:', e.message);
    }
  }
  const list = productOrders.map((po) => {
    const d = cache.get(po.productOrderId);
    return { ...po, recipient: d?.recipient || null, memo: d?.memo || '' };
  });
  return { list, error };
}

export function clearDetails() {
  cache.clear();
}
