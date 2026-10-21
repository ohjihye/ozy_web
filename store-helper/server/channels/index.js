import { naver } from './naver.js';
import { mock } from './mock.js';

// ── 스토어(채널) 목록 ─────────────────────────
// 새 스토어(예: 쿠팡)를 붙이려면 같은 모양의 어댑터 파일을 만들고 아래 목록에 넣으면 됩니다.
//
// 어댑터가 갖춰야 할 것:
//   id, label, adminUrl, enabled()
//   changedOrders(since: Date, now: Date) → 공통 상품주문[]
//   details(rawIds: string[])             → 공통 상품주문[] (받는 분 정보 다시 조회)
//   unansweredInquiries()                 → [{ id, kind, title, content, createdAt }]
//
// 공통 상품주문 형식 (id 들은 그 스토어의 원래 번호):
//   { orderId, orderedAt, productOrderId, productName, productOption, quantity,
//     status, pending, recipient: { name, phone, phone2, zip, address1, address2 }, memo }
//   pending = 아직 포장·발송해야 하는 주문이면 true
//
// 앱 안에서는 여러 스토어의 번호가 겹치지 않도록 "naver:123" 처럼 스토어 id 를 앞에 붙여 씁니다.
export const ALL_CHANNELS = [naver, mock];

export const enabledChannels = () => ALL_CHANNELS.filter((c) => c.enabled());
export const channelById = (id) => ALL_CHANNELS.find((c) => c.id === id);

export const prefixed = (channelId, rawId) => `${channelId}:${rawId}`;
export function splitId(id) {
  const i = String(id).indexOf(':');
  return i < 0 ? ['naver', String(id)] : [id.slice(0, i), id.slice(i + 1)];
}

// 어댑터가 준 상품주문에 스토어 표시를 붙이고 번호에 스토어 id 를 붙입니다
export function tag(channel, po) {
  return {
    ...po,
    channel: channel.id,
    orderId: prefixed(channel.id, po.orderId),
    productOrderId: prefixed(channel.id, po.productOrderId),
  };
}

export function tagInquiry(channel, q) {
  return { ...q, channel: channel.id, id: prefixed(channel.id, q.id) };
}

// 여러 스토어에 섞여 있는 상품주문 번호들의 받는 분 정보를 스토어별로 나눠서 조회합니다
export async function fetchDetails(ids) {
  const byChannel = new Map();
  for (const id of ids) {
    const [channelId, raw] = splitId(id);
    if (!byChannel.has(channelId)) byChannel.set(channelId, []);
    byChannel.get(channelId).push(raw);
  }
  const results = [];
  const errors = [];
  for (const [channelId, rawIds] of byChannel) {
    const channel = channelById(channelId);
    if (!channel?.enabled()) continue;
    try {
      for (const po of await channel.details(rawIds)) results.push(tag(channel, po));
    } catch (e) {
      errors.push(`${channel.label}: ${e.message}`);
    }
  }
  if (errors.length && !results.length) throw new Error(errors.join(', '));
  if (errors.length) console.warn('[details] 일부 스토어 조회 실패:', errors.join(', '));
  return results;
}

export function channelInfo() {
  return enabledChannels().map((c) => ({ id: c.id, label: c.label, adminUrl: c.adminUrl }));
}
