import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProducts, matchProduct, groupOrders } from '../server/products.js';
import { maskName, orderSummary } from '../server/notify.js';
import { normalizeProductOrder, toKstIso } from '../server/naver.js';

const products = loadProducts();
const id = (name, opt) => matchProduct(products, name, opt)?.id ?? null;

test('상품명과 옵션으로 상품을 구분한다', () => {
  assert.equal(id('착즙 생강청', '용량: 650g'), 'ginger-650');
  assert.equal(id('착즙 레몬생강청', '650g'), 'lemon-ginger-650');
  assert.equal(id('생강청 스틱', '20개 세트'), 'ginger-stick-20');
  assert.equal(id('생강청 스틱', '40개 세트'), 'ginger-stick-40');
  assert.equal(id('레몬생강청 스틱', '구성: 20개 세트'), 'lemon-ginger-stick-20');
  assert.equal(id('레몬 생강청 스틱', '40 개 세트'), 'lemon-ginger-stick-40');
  assert.equal(id('대추청', '500g'), null);
});

test('상품주문을 주문 단위로 묶는다', () => {
  const r = { name: '김하늘' };
  const orders = groupOrders(products, [
    { orderId: 'A', orderedAt: '2', productOrderId: 'A1', productName: '착즙 생강청', productOption: '650g', quantity: 2, recipient: r },
    { orderId: 'A', orderedAt: '2', productOrderId: 'A2', productName: '대추청', productOption: '', quantity: 1, recipient: r },
    { orderId: 'B', orderedAt: '1', productOrderId: 'B1', productName: '생강청 스틱', productOption: '20개', quantity: 1, recipient: r },
  ]);
  assert.deepEqual(orders.map((o) => o.orderId), ['B', 'A']);
  assert.equal(orders[1].items.length, 2);
  assert.equal(orders[1].items[1].known, false);
  assert.equal(orders[1].items[1].name, '대추청');
});

test('알림에는 이름을 가려서 보낸다', () => {
  assert.equal(maskName('김하늘'), '김*늘');
  assert.equal(maskName('남궁하늘'), '남**늘');
  assert.equal(maskName('김하'), '김*');
  const text = orderSummary([{ recipient: { name: '김하늘' }, items: [{ name: '착즙 생강청 650g', quantity: 2 }] }]);
  assert.match(text, /김\*늘님 착즙 생강청 650g ×2/);
});

test('네이버 응답을 정규화한다', () => {
  const po = normalizeProductOrder({
    order: { orderId: 'O1', paymentDate: '2026-10-08T10:00:00.0+09:00' },
    productOrder: {
      productOrderId: 'P1', productName: '착즙 생강청', productOption: '650g', quantity: 2, productOrderStatus: 'PAYED',
      shippingAddress: { name: '홍길동', tel1: '010-1111-2222', zipCode: '12345', baseAddress: '서울시', detailedAddress: '1호' },
      shippingMemo: '부재시 문 앞',
    },
  });
  assert.equal(po.recipient.address2, '1호');
  assert.equal(po.status, 'PAYED');
  assert.equal(po.memo, '부재시 문 앞');
});

test('한국 시간 ISO 형식', () => {
  assert.equal(toKstIso(new Date('2026-10-08T00:00:00Z')), '2026-10-08T09:00:00.000+09:00');
});
