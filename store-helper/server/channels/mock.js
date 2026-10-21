import { config } from '../config.js';
import { fakeOrder, fakeInquiry } from '../mock.js';

// 개발용 가짜 스토어. MOCK=1 일 때만 켜집니다.
// 만든 가짜 주문을 메모리에 기억해 두고, 받는 분 정보를 다시 물으면 돌려줍니다.
const registry = new Map();
let seeded = false;

export const mock = {
  id: 'mock',
  label: '테스트',
  adminUrl: 'https://sell.smartstore.naver.com/',
  enabled: () => config.mock,

  // 처음 한 번만 예시 주문 2건을 만듭니다
  async changedOrders() {
    if (seeded) return [];
    seeded = true;
    return [...this.createOrder(), ...this.createOrder()];
  },

  async details(rawIds) {
    return rawIds.map((id) => registry.get(id)).filter(Boolean);
  },

  async unansweredInquiries() {
    return [fakeInquiry()];
  },

  // "가짜 주문 추가" 버튼용
  createOrder() {
    const list = fakeOrder().map((po) => ({ ...po, pending: true }));
    for (const po of list) registry.set(po.productOrderId, po);
    return list;
  },
};
