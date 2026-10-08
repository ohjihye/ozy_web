import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

export function loadProducts() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'products.json'), 'utf8'));
}

const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

// 네이버 상품명+옵션 문자열을 products.json 의 상품으로 매칭합니다.
// 못 찾으면 null → 화면에 "미등록 상품"으로 원래 이름을 보여줍니다.
export function matchProduct(products, productName, productOption) {
  const text = norm(`${productName} ${productOption || ''}`);
  return (
    products.find(
      (p) => p.match.every((k) => text.includes(norm(k))) && !p.exclude.some((k) => text.includes(norm(k))),
    ) || null
  );
}

// 네이버 상품주문(productOrder) 단위 데이터를 주문(orderId) 단위로 묶습니다.
// 입력: [{ orderId, orderedAt, productOrderId, productName, productOption, quantity, status, recipient, memo }]
export function groupOrders(products, productOrders) {
  const byId = new Map();
  for (const po of productOrders) {
    let o = byId.get(po.orderId);
    if (!o) {
      o = { orderId: po.orderId, orderedAt: po.orderedAt, recipient: po.recipient, memo: po.memo || '', items: [] };
      byId.set(po.orderId, o);
    }
    const p = matchProduct(products, po.productName, po.productOption);
    o.items.push({
      productOrderId: po.productOrderId,
      productId: p?.id || null,
      name: p?.name || [po.productName, po.productOption].filter(Boolean).join(' / '),
      color: p?.color || '#888888',
      known: Boolean(p),
      quantity: po.quantity,
      status: po.status,
    });
  }
  return [...byId.values()].sort((a, b) => String(a.orderedAt).localeCompare(String(b.orderedAt)));
}
