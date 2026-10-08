import { config } from './config.js';
import * as naver from './naver.js';
import * as mock from './mock.js';
import { getState, save, prune } from './store.js';
import { loadProducts, groupOrders } from './products.js';
import { notifyNewOrders, notifyNewInquiries } from './notify.js';

const FIRST_RUN_DAYS = 3; // 처음 실행 시 며칠 전까지 거슬러 올라가 발송 전 주문을 가져올지
const OVERLAP_MS = 5 * 60 * 1000; // 조회 구간을 5분 겹쳐서 누락 방지

// 상품주문 목록을 상태에 반영하고, 처음 보는 결제완료 주문을 돌려줍니다.
export function applyProductOrders(productOrders, { notify = true } = {}) {
  const state = getState();
  const fresh = [];
  for (const po of productOrders) {
    if (po.status === 'PAYED') {
      state.productOrders[po.productOrderId] = po;
      if (!state.seenProductOrders[po.productOrderId]) {
        state.seenProductOrders[po.productOrderId] = new Date().toISOString();
        if (notify) fresh.push(po);
      }
    } else {
      // 발송·취소·반품 등 → 더 이상 처리할 필요 없음, 고객 정보도 삭제
      delete state.productOrders[po.productOrderId];
      state.seenProductOrders[po.productOrderId] ||= new Date().toISOString();
    }
  }
  return groupOrders(loadProducts(), fresh);
}

export function applyInquiries(list) {
  const state = getState();
  const fresh = list.filter((q) => !state.seenInquiries[q.id]);
  for (const q of fresh) state.seenInquiries[q.id] = new Date().toISOString();
  state.inquiries = Object.fromEntries(list.map((q) => [q.id, q]));
  return fresh;
}

export async function pollOnce() {
  const state = getState();
  const startedAt = new Date();

  let newOrders = [];
  let newInquiries = [];
  if (config.mock) {
    // 가짜 모드: 처음 한 번만 예시 주문 2건과 문의 1건을 만듭니다
    if (!state.lastPolledAt) {
      newOrders = applyProductOrders([...mock.fakeOrder(), ...mock.fakeOrder()]);
      newInquiries = applyInquiries([mock.fakeInquiry()]);
    }
  } else {
    const since = state.lastPolledAt
      ? new Date(Date.parse(state.lastPolledAt) - OVERLAP_MS)
      : new Date(startedAt.getTime() - FIRST_RUN_DAYS * 24 * 3600 * 1000);
    const ids = await naver.changedProductOrderIds(since, startedAt);
    if (ids.length) newOrders = applyProductOrders(await naver.productOrderDetails(ids));
    newInquiries = applyInquiries(await naver.unansweredInquiries());
  }

  state.lastPolledAt = startedAt.toISOString();
  prune();
  save();

  await notifyNewOrders(newOrders);
  await notifyNewInquiries(newInquiries);
  return { newOrders: newOrders.length, newInquiries: newInquiries.length };
}

export function startPolling() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await pollOnce();
      if (r.newOrders || r.newInquiries) console.log(`[poll] 새 주문 ${r.newOrders}, 새 문의 ${r.newInquiries}`);
    } catch (e) {
      console.error('[poll] 실패:', e.message);
    } finally {
      running = false;
    }
  };
  tick();
  return setInterval(tick, config.pollSeconds * 1000);
}
