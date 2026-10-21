// 예전 버전이 디스크에 저장한 고객 정보를 새 버전이 처음 읽을 때 지우는지 확인합니다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('예전 state.json 의 고객 정보를 지우고 여러 스토어 형식으로 바꾼다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-mig-'));
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, JSON.stringify({
    lastPolledAt: '2026-10-01T00:00:00.000Z',
    productOrders: { P1: { orderId: 'O1', productOrderId: 'P1', status: 'PAYED', recipient: { name: '홍길동', phone: '010-0000-0000' }, memo: '문앞' } },
    seenProductOrders: { P1: '2026-10-01T00:00:00.000Z' },
    packed: { O1: '2026-10-01T01:00:00.000Z' },
    seenInquiries: { 'q-7': '2026-10-01T00:00:00.000Z' },
    inquiries: { q1: { content: '문의 내용' } },
  }));
  process.env.DATA_DIR = dir;
  const { getState } = await import('../server/store.js');
  const s = getState();
  // 스토어가 하나뿐이던 예전 번호에 "naver:" 가 붙는다
  assert.deepEqual(Object.keys(s.productOrders), ['naver:P1']);
  assert.equal(s.productOrders['naver:P1'].orderId, 'naver:O1');
  assert.equal(s.productOrders['naver:P1'].channel, 'naver');
  assert.equal(s.productOrders['naver:P1'].pending, true);
  assert.ok(s.seenProductOrders['naver:P1']);
  assert.ok(s.packed['naver:O1']);
  assert.ok(s.seenInquiries['naver:q-7']);
  assert.equal(s.channels.naver.lastPolledAt, '2026-10-01T00:00:00.000Z');
  const saved = fs.readFileSync(file, 'utf8');
  assert.ok(!saved.includes('홍길동'));
  assert.ok(!saved.includes('문의 내용'));
  fs.rmSync(dir, { recursive: true, force: true });
});
