// 서버 없이 화면을 볼 때 쓰는 예시 데이터 (실제 고객 정보 아님)
window.DEMO_DATA = {
  mock: true,
  lastPolledAt: new Date().toISOString(),
  orders: [
    {
      orderId: 'DEMO-1', orderedAt: '2026-10-08T09:12:00+09:00', packedAt: null, memo: '문 앞에 놓아주세요',
      recipient: { name: '김하늘', phone: '010-0000-1234', zip: '06236', address1: '서울특별시 강남구 테헤란로 123', address2: '가나빌딩 4층' },
      items: [
        { productOrderId: 'D1a', name: '착즙 생강청 650g', color: '#c98a1b', known: true, quantity: 2 },
        { productOrderId: 'D1b', name: '생강청 스틱 20개 세트', color: '#8a5a14', known: true, quantity: 1 },
      ],
    },
    {
      orderId: 'DEMO-2', orderedAt: '2026-10-08T10:40:00+09:00', packedAt: null, memo: '',
      recipient: { name: '이바다', phone: '010-0000-5678', zip: '48058', address1: '부산광역시 해운대구 센텀중앙로 45', address2: '101동 1001호' },
      items: [
        { productOrderId: 'D2a', name: '착즙 레몬생강청 650g', color: '#e3c22b', known: true, quantity: 1 },
        { productOrderId: 'D2b', name: '레몬생강청 스틱 40개 세트', color: '#5f7a12', known: true, quantity: 2 },
      ],
    },
    {
      orderId: 'DEMO-3', orderedAt: '2026-10-08T13:05:00+09:00', packedAt: '2026-10-08T14:00:00+09:00', memo: '',
      recipient: { name: '박구름', phone: '010-0000-9012', zip: '35233', address1: '대전광역시 서구 둔산로 100', address2: '라마아파트 202동 303호' },
      items: [{ productOrderId: 'D3a', name: '착즙 생강청 650g', color: '#c98a1b', known: true, quantity: 3 }],
    },
  ],
  inquiries: [
    { id: 'q-demo-1', kind: '상품문의', title: '착즙 생강청', content: '개봉 후 냉장 보관하면 얼마나 먹을 수 있나요?', createdAt: '2026-10-08T11:20:00+09:00' },
  ],
};
