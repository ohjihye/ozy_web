// 개발용 가짜 데이터 (실제 고객 정보 아님)
const names = ['김하늘', '이바다', '박구름', '최들꽃', '정새봄'];
const addrs = [
  ['06236', '서울특별시 강남구 테헤란로 123', '가나빌딩 4층'],
  ['48058', '부산광역시 해운대구 센텀중앙로 45', '101동 1001호'],
  ['35233', '대전광역시 서구 둔산로 100', '라마아파트 202동 303호'],
];
const items = [
  ['착즙 생강청', '용량: 650g'],
  ['착즙 레몬생강청', '용량: 650g'],
  ['생강청 스틱', '구성: 20개 세트'],
  ['레몬생강청 스틱', '구성: 40개 세트'],
];

let seq = 1;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function fakeOrder() {
  const orderId = `TEST${Date.now()}${seq++}`;
  const [zip, address1, address2] = pick(addrs);
  const recipient = {
    name: pick(names), phone: `010-0000-${String(1000 + seq).slice(-4)}`, phone2: '',
    zip, address1, address2,
  };
  const count = 1 + Math.floor(Math.random() * 2);
  return Array.from({ length: count }, (_, i) => {
    const [productName, productOption] = items[(seq + i) % items.length];
    return {
      orderId, orderedAt: new Date().toISOString(), productOrderId: `${orderId}-${i}`,
      productName, productOption, quantity: 1 + Math.floor(Math.random() * 3),
      status: 'PAYED', recipient, memo: i === 0 ? '문 앞에 놓아주세요' : '',
    };
  });
}

export function fakeInquiry() {
  return { id: `q-test-${seq++}`, kind: '상품문의', title: '착즙 생강청', content: '유통기한이 어떻게 되나요? (테스트 문의)', createdAt: new Date().toISOString() };
}
