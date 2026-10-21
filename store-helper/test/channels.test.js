// 여러 스토어를 동시에 붙였을 때의 동작을 가짜 스토어 두 개로 확인합니다
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-ch-'));
Object.assign(process.env, { DATA_DIR: dataDir, MOCK: '0', NAVER_CLIENT_ID: '', NAVER_CLIENT_SECRET: '' });
const { ALL_CHANNELS, enabledChannels, fetchDetails, splitId } = await import('../server/channels/index.js');
const { pollOnce, currentInquiries } = await import('../server/poller.js');
const { getState } = await import('../server/store.js');
const { matchProduct, loadProducts } = await import('../server/products.js');

const order = (id, extra = {}) => ({
  orderId: `O${id}`, orderedAt: '2026-10-21T01:00:00Z', productOrderId: id, productName: '착즙 생강청',
  productOption: '650g', quantity: 1, status: 'X', pending: true,
  recipient: { name: `손님${id}`, phone: '010-0000-0000', zip: '00000', address1: '주소', address2: '' }, memo: '', ...extra,
});

let failB = false;
const storeA = {
  id: 'storea', label: '스토어A', adminUrl: 'https://a.example', enabled: () => true,
  changedOrders: async () => [order('1')],
  details: async (ids) => ids.map((id) => order(id)),
  unansweredInquiries: async () => [{ id: 'q1', kind: '문의', title: '', content: 'A 문의', createdAt: '' }],
};
const storeB = {
  id: 'storeb', label: '스토어B', adminUrl: 'https://b.example', enabled: () => true,
  changedOrders: async () => {
    if (failB) throw new Error('B 서버 점검 중');
    return [order('1', { recipient: { name: 'B손님' } })]; // A와 같은 번호 "1"
  },
  details: async (ids) => ids.map((id) => order(id)),
  unansweredInquiries: async () => [],
};

before(() => {
  console.log = () => {};
  console.error = () => {};
  ALL_CHANNELS.push(storeA, storeB);
});
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('켜진 스토어만 확인한다 (네이버 키가 없으면 네이버는 꺼짐)', () => {
  assert.deepEqual(enabledChannels().map((c) => c.id), ['storea', 'storeb']);
});

test('스토어가 달라도 번호가 겹치지 않는다', async () => {
  const r = await pollOnce();
  assert.equal(r.newOrders, 2);
  const keys = Object.keys(getState().productOrders).sort();
  assert.deepEqual(keys, ['storea:1', 'storeb:1']);
  assert.equal(getState().productOrders['storeb:1'].channel, 'storeb');
  assert.equal(currentInquiries()[0].id, 'storea:q1');
});

test('한 스토어가 실패해도 다른 스토어는 계속 확인한다', async () => {
  failB = true;
  await pollOnce();
  const ch = getState().channels;
  assert.equal(ch.storea.lastError, null);
  assert.match(ch.storeb.lastError.message, /점검/);
  assert.ok(getState().productOrders['storea:1']);
  failB = false;
  await pollOnce();
  assert.equal(getState().channels.storeb.lastError, null);
});

test('받는 분 정보는 스토어별로 나눠서 다시 조회한다', async () => {
  const got = await fetchDetails(['storea:7', 'storeb:8', 'storeb:9']);
  assert.deepEqual(got.map((po) => po.productOrderId).sort(), ['storea:7', 'storeb:8', 'storeb:9']);
  assert.deepEqual(splitId('naver:2026:1'), ['naver', '2026:1']);
});

test('스토어마다 다른 상품명 규칙을 쓸 수 있다', () => {
  const products = [
    ...loadProducts(),
    { id: 'gift', name: '선물세트', match: ['선물세트'], exclude: [], channels: { storeb: { match: ['기프트박스'] } } },
  ];
  assert.equal(matchProduct(products, '생강 기프트박스', '', 'storeb')?.id, 'gift');
  assert.equal(matchProduct(products, '생강 기프트박스', '', 'storea'), null);
  assert.equal(matchProduct(products, '생강청 선물세트', '', 'storea')?.id, 'gift');
});
