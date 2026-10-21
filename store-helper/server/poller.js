import { config } from './config.js';
import { getState, save, prune } from './store.js';
import { loadProducts, groupOrders } from './products.js';
import { notifyNewOrders, notifyNewInquiries } from './notify.js';
import { remember, forget, withoutPersonal } from './details.js';
import { enabledChannels, tag, tagInquiry } from './channels/index.js';

const FIRST_RUN_DAYS = 3; // 처음 실행 시 며칠 전까지 거슬러 올라가 발송 전 주문을 가져올지
const OVERLAP_MS = 5 * 60 * 1000; // 조회 구간을 5분 겹쳐서 누락 방지

// 상품주문 목록(스토어 표시가 붙은 것)을 상태에 반영하고, 처음 보는 처리할 주문을 돌려줍니다.
export function applyProductOrders(productOrders, { notify = true } = {}) {
  const state = getState();
  const fresh = [];
  for (const po of productOrders) {
    if (po.pending) {
      remember(po); // 개인정보는 메모리에만
      state.productOrders[po.productOrderId] = withoutPersonal(po);
      if (!state.seenProductOrders[po.productOrderId]) {
        state.seenProductOrders[po.productOrderId] = new Date().toISOString();
        if (notify) fresh.push(po);
      }
    } else {
      // 발송·취소·반품 등 → 더 이상 처리할 필요 없음, 고객 정보도 삭제
      delete state.productOrders[po.productOrderId];
      forget(po.productOrderId);
      state.seenProductOrders[po.productOrderId] ||= new Date().toISOString();
    }
  }
  return groupOrders(loadProducts(), fresh);
}

// 미답변 문의 목록은 고객이 쓴 글이라 메모리에만 둡니다 (서버를 켜면 다음 확인 때 다시 채워짐)
const inquiriesByChannel = new Map();
export const currentInquiries = () => [...inquiriesByChannel.values()].flat();

export function applyInquiries(channelId, list) {
  const state = getState();
  const fresh = list.filter((q) => !state.seenInquiries[q.id]);
  for (const q of fresh) state.seenInquiries[q.id] = new Date().toISOString();
  inquiriesByChannel.set(channelId, list);
  return fresh;
}

// 스토어 하나 확인하기. 실패해도 다른 스토어는 계속 확인합니다.
async function pollChannel(channel, startedAt) {
  const state = getState();
  const cs = (state.channels[channel.id] ||= { lastPolledAt: null, lastError: null });
  try {
    const since = cs.lastPolledAt
      ? new Date(Date.parse(cs.lastPolledAt) - OVERLAP_MS)
      : new Date(startedAt.getTime() - FIRST_RUN_DAYS * 24 * 3600 * 1000);
    const orders = (await channel.changedOrders(since, startedAt)).map((po) => tag(channel, po));
    const newOrders = applyProductOrders(orders);
    const inquiries = (await channel.unansweredInquiries()).map((q) => tagInquiry(channel, q));
    const newInquiries = applyInquiries(channel.id, inquiries);
    cs.lastPolledAt = startedAt.toISOString();
    cs.lastError = null;
    return { newOrders, newInquiries };
  } catch (e) {
    cs.lastError = { at: startedAt.toISOString(), message: e.message };
    console.error(`[poll] ${channel.label} 확인 실패:`, e.message);
    return { newOrders: [], newInquiries: [] };
  }
}

export async function pollOnce() {
  const state = getState();
  const startedAt = new Date();
  const newOrders = [];
  const newInquiries = [];
  for (const channel of enabledChannels()) {
    const r = await pollChannel(channel, startedAt);
    newOrders.push(...r.newOrders);
    newInquiries.push(...r.newInquiries);
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
