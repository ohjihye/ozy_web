import bcrypt from 'bcryptjs';
import { config } from './config.js';

// 네이버 커머스API 클라이언트
// 문서: https://apicenter.commerce.naver.com/docs/commerce-api/current
// ※ 실제 계정으로 아직 검증 전입니다. 처음 연결할 때 응답 형식을 확인하세요.
const BASE = 'https://api.commerce.naver.com/external';

let token = null; // { value, expiresAt }

// 2022-04-11T10:00:00.000+09:00 형식 (한국 시간)
export function toKstIso(date) {
  const kst = new Date(date.getTime() + 9 * 3600 * 1000);
  return kst.toISOString().replace('Z', '+09:00');
}

async function getToken() {
  if (token && token.expiresAt - Date.now() > 5 * 60 * 1000) return token.value;
  const { clientId, clientSecret } = config.naver;
  const timestamp = Date.now();
  // 전자서명: bcrypt(clientId_timestamp, salt=clientSecret) → base64
  const sign = Buffer.from(bcrypt.hashSync(`${clientId}_${timestamp}`, clientSecret)).toString('base64');
  const body = new URLSearchParams({
    client_id: clientId,
    timestamp: String(timestamp),
    client_secret_sign: sign,
    grant_type: 'client_credentials',
    type: 'SELF',
  });
  const res = await fetch(`${BASE}/v1/oauth2/token`, { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`네이버 토큰 발급 실패 (${res.status}): ${json.message || JSON.stringify(json)}`);
  }
  token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return token.value;
}

async function api(method, path, { query, body } = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`네이버 API 오류 ${method} ${path} (${res.status}): ${json.message || ''}`);
  return json;
}

// since~now 사이 상태가 바뀐 상품주문 ID 목록
// API 한 번 조회 범위가 최대 24시간이라 하루씩 나눠서 조회하고, 페이지(more)도 이어받습니다.
export async function changedProductOrderIds(since, now = new Date()) {
  const DAY = 24 * 3600 * 1000;
  const ids = new Set();
  for (let start = since.getTime(); start < now.getTime(); start += DAY) {
    const end = new Date(Math.min(start + DAY, now.getTime()));
    let from = toKstIso(new Date(start));
    let moreSequence;
    for (let page = 0; page < 50; page++) {
      const json = await api('GET', '/v1/pay-order/seller/product-orders/last-changed-statuses', {
        query: { lastChangedFrom: from, lastChangedTo: toKstIso(end), moreSequence },
      });
      for (const s of json.data?.lastChangeStatuses || []) ids.add(s.productOrderId);
      const more = json.data?.more;
      if (!more?.moreFrom) break;
      from = more.moreFrom;
      moreSequence = more.moreSequence;
    }
  }
  return [...ids];
}

// 상품주문 상세 조회 → 앱에서 쓰는 형태로 정규화
export async function productOrderDetails(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 300) {
    const json = await api('POST', '/v1/pay-order/seller/product-orders/query', {
      body: { productOrderIds: ids.slice(i, i + 300) },
    });
    for (const d of json.data || []) out.push(normalizeProductOrder(d));
  }
  return out;
}

export function normalizeProductOrder({ order = {}, productOrder = {} }) {
  const a = productOrder.shippingAddress || {};
  return {
    orderId: order.orderId,
    orderedAt: order.paymentDate || order.orderDate,
    productOrderId: productOrder.productOrderId,
    productName: productOrder.productName,
    productOption: productOrder.productOption || '',
    quantity: Number(productOrder.quantity || 1),
    status: productOrder.productOrderStatus, // PAYED = 결제완료(발송 전)
    recipient: {
      name: a.name || '',
      phone: a.tel1 || '',
      phone2: a.tel2 || '',
      zip: a.zipCode || '',
      address1: a.baseAddress || '',
      address2: a.detailedAddress || '',
    },
    memo: productOrder.shippingMemo || '',
  };
}

const ymd = (d) => toKstIso(d).slice(0, 10);

// 미답변 문의: 고객문의 + 상품문의(Q&A)
export async function unansweredInquiries(days = 7) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 3600 * 1000);
  const result = [];

  const customer = await api('GET', '/v1/pay-user/inquiries', {
    query: { startSearchDate: ymd(from), endSearchDate: ymd(to), answered: false, size: 100 },
  }).catch((e) => (console.warn('[naver] 고객문의 조회 실패:', e.message), null));
  for (const q of customer?.data?.content || customer?.content || []) {
    result.push({
      id: `c-${q.inquiryNo}`,
      kind: '고객문의',
      title: q.title || q.category || '',
      content: q.inquiryContent || '',
      createdAt: q.inquiryRegistrationDateTime || '',
    });
  }

  const qna = await api('GET', '/v1/contents/qnas', {
    query: { fromDate: toKstIso(from), toDate: toKstIso(to), answered: false, size: 100 },
  }).catch((e) => (console.warn('[naver] 상품문의 조회 실패:', e.message), null));
  for (const q of qna?.contents || qna?.data?.contents || []) {
    result.push({
      id: `q-${q.questionId}`,
      kind: '상품문의',
      title: q.productName || '',
      content: q.question || '',
      createdAt: q.createDate || '',
    });
  }
  return result;
}
