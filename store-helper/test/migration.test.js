// 예전 버전이 디스크에 저장한 고객 정보를 새 버전이 처음 읽을 때 지우는지 확인합니다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('예전 state.json 의 고객 정보와 문의 내용을 지운다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-mig-'));
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, JSON.stringify({
    productOrders: { P1: { orderId: 'O1', productOrderId: 'P1', recipient: { name: '홍길동', phone: '010-0000-0000' }, memo: '문앞' } },
    inquiries: { q1: { content: '문의 내용' } },
  }));
  process.env.DATA_DIR = dir;
  const { getState } = await import('../server/store.js');
  const s = getState();
  assert.equal(s.productOrders.P1.orderId, 'O1');
  const saved = fs.readFileSync(file, 'utf8');
  assert.ok(!saved.includes('홍길동'));
  assert.ok(!saved.includes('문의 내용'));
  fs.rmSync(dir, { recursive: true, force: true });
});
