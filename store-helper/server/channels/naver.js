import { config } from '../config.js';
import * as api from '../naver.js';

// 네이버 스마트스토어 어댑터
// 네이버의 주문을 앱 공통 형식으로 바꿔서 돌려줍니다. (공통 형식은 channels/index.js 설명 참고)
export const naver = {
  id: 'naver',
  label: '네이버',
  adminUrl: 'https://sell.smartstore.naver.com/',
  enabled: () => !config.mock && Boolean(config.naver.clientId && config.naver.clientSecret),

  // since 이후 상태가 바뀐 상품주문 (받는 분 정보 포함)
  async changedOrders(since, now) {
    const ids = await api.changedProductOrderIds(since, now);
    return ids.length ? (await api.productOrderDetails(ids)).map(toCommon) : [];
  },

  // 받는 분 정보를 다시 조회 (ids 는 이 스토어의 원래 상품주문번호)
  async details(rawIds) {
    return (await api.productOrderDetails(rawIds)).map(toCommon);
  },

  async unansweredInquiries() {
    return api.unansweredInquiries();
  },
};

function toCommon(po) {
  return { ...po, pending: po.status === 'PAYED' }; // 결제완료(발송 전)만 처리할 주문
}
