import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachDetails, remember, clearDetails, withoutPersonal } from '../server/details.js';

const po = (id) => ({ orderId: 'O', productOrderId: id, productName: 'x', quantity: 1, status: 'PAYED' });
const withInfo = (id) => ({ ...po(id), recipient: { name: '홍길동' }, memo: '메모' });

test('개인정보 필드를 떼어낸다', () => {
  const stripped = withoutPersonal(withInfo('A'));
  assert.equal('recipient' in stripped, false);
  assert.equal('memo' in stripped, false);
  assert.equal(stripped.productOrderId, 'A');
});

test('캐시에 있으면 다시 조회하지 않고, 10분이 지나면 다시 조회한다', async () => {
  clearDetails();
  const now = Date.now();
  remember(withInfo('A'), now);
  let calls = 0;
  const fetchDetails = async (ids) => { calls++; return ids.map(withInfo); };
  let { list } = await attachDetails([po('A')], fetchDetails, now + 1000);
  assert.equal(calls, 0);
  assert.equal(list[0].recipient.name, '홍길동');
  ({ list } = await attachDetails([po('A')], fetchDetails, now + 11 * 60 * 1000));
  assert.equal(calls, 1);
});

test('조회에 실패하면 받는 분 정보 없이 돌려준다', async () => {
  clearDetails();
  const { list, error } = await attachDetails([po('B')], async () => { throw new Error('네이버 오류'); });
  assert.equal(list[0].recipient, null);
  assert.match(error, /네이버 오류/);
});
