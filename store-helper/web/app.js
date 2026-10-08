'use strict';

// ── 작은 도우미 ──────────────────────────────
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 불가 환경 */ }
  },
};
const timeText = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const fullAddress = (r) => [r.address1, r.address2].filter(Boolean).join(' ');

// ── 상태 ────────────────────────────────────
const S = {
  data: { orders: [], inquiries: [], lastPolledAt: null, mock: false },
  demo: false,
  password: store.get('password', ''),
  pack: store.get('pack', {}), // orderId → { productOrderId: 넣은 개수 }
  settings: store.get('settings', { sender: '', senderPhone: '', driver: '' }),
  packingId: null,
};

// ── 서버 통신 ────────────────────────────────
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${S.password}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { const e = new Error('unauthorized'); e.auth = true; throw e; }
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.includes('json')) { const e = new Error('no server'); e.noServer = true; throw e; }
  return res.json();
}

async function load() {
  if (S.demo) return render();
  try {
    S.data = await api('/api/orders');
    $('#loginSheet').hidden = true;
  } catch (e) {
    if (e.auth) { showLogin(); return; }
    // 서버가 없으면(미리보기 등) 예시 데이터로 보여줍니다
    S.demo = true;
    S.data = structuredClone(window.DEMO_DATA);
  }
  render();
}

function showLogin(wrong = false) {
  $('#loginSheet').hidden = false;
  $('#loginError').hidden = !wrong;
  $('#password').focus();
}

$('#loginForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  S.password = $('#password').value;
  try {
    S.data = await api('/api/orders');
    store.set('password', S.password);
    $('#loginSheet').hidden = true;
    render();
  } catch (e) {
    if (e.auth) showLogin(true);
  }
});

// ── 화면 그리기 ──────────────────────────────
function render() {
  const { orders, inquiries, lastPolledAt } = S.data;
  const packed = orders.filter((o) => o.packedAt);
  $('#statOrders').textContent = orders.length;
  $('#statPacked').textContent = packed.length;
  $('#statInq').textContent = inquiries.length;
  $('#statOrders').closest('.stat').classList.toggle('alert', orders.length - packed.length > 0);
  $('#statInq').closest('.stat').classList.toggle('alert', inquiries.length > 0);
  $('#demoNote').hidden = !S.demo;
  $('#fakeOrder').hidden = !S.data.mock || S.demo;
  $('#sync').textContent = S.demo ? '예시 화면' : lastPolledAt ? `마지막 확인 ${timeText(lastPolledAt)}` : '확인 대기 중';

  const sorted = [...orders].sort((a, b) => Boolean(a.packedAt) - Boolean(b.packedAt));
  $('#orders').innerHTML = sorted.length
    ? sorted.map(orderCard).join('')
    : '<li class="empty">발송할 주문이 없어요.<br>새 주문이 들어오면 카톡으로 알려드릴게요.</li>';

  $('#inquiries').innerHTML = inquiries.length
    ? inquiries.map((q) => `
      <li class="inquiry">
        <small>${esc(q.kind)} · ${esc(timeText(q.createdAt))}${q.title ? ` · ${esc(q.title)}` : ''}</small>
        <span>${esc(q.content)}</span>
      </li>`).join('')
    : '<li class="empty">답변할 문의가 없어요.</li>';
}

function orderCard(o) {
  const r = o.recipient;
  const total = o.items.reduce((n, i) => n + i.quantity, 0);
  return `
  <li class="order${o.packedAt ? ' packed' : ''}">
    <div class="order-head">
      <span class="order-name">${esc(r.name)}</span>
      <span class="pill${o.packedAt ? ' ok' : ''}">${o.packedAt ? '포장 완료' : `포장 전 · ${total}개`}</span>
    </div>
    <p class="addr"><span class="zip">(${esc(r.zip)})</span> ${esc(fullAddress(r))}<br><span class="phone">${esc(r.phone)}</span></p>
    ${o.memo ? `<p class="memo">배송메모: ${esc(o.memo)}</p>` : ''}
    <ul class="items">
      ${o.items.map((i) => `
        <li class="item">
          <span class="swatch" style="background:${esc(i.color)}"></span>
          <span class="item-name">${esc(i.name)}${i.known ? '' : ' <span class="unknown">미등록 상품</span>'}</span>
          <span class="qty">×${i.quantity}</span>
        </li>`).join('')}
    </ul>
    <button class="btn ${o.packedAt ? '' : 'primary'}" data-pack="${esc(o.orderId)}" type="button">
      ${o.packedAt ? '포장 다시 확인' : '포장 확인 시작'}
    </button>
  </li>`;
}

// ── 탭 ──────────────────────────────────────
function showTab(name) {
  for (const t of ['orders', 'inquiries', 'settings']) {
    $(`#panel-${t}`).hidden = t !== name;
    $(`#tab-${t}`).setAttribute('aria-selected', String(t === name));
  }
}
document.addEventListener('click', (ev) => {
  const tab = ev.target.closest('[data-tab]');
  if (tab) showTab(tab.dataset.tab);
  const close = ev.target.closest('[data-close]');
  if (close) close.closest('.sheet').hidden = true;
  const pack = ev.target.closest('[data-pack]');
  if (pack) openPack(pack.dataset.pack);
});

// ── 포장 검수 ────────────────────────────────
function openPack(orderId) {
  S.packingId = orderId;
  renderPack();
  $('#packSheet').hidden = false;
  $('#packSheet').scrollTop = 0;
}

function renderPack() {
  const o = S.data.orders.find((x) => x.orderId === S.packingId);
  if (!o) { $('#packSheet').hidden = true; return; }
  const counts = S.pack[o.orderId] || {};
  const allDone = o.items.every((i) => (counts[i.productOrderId] || 0) >= i.quantity);
  const hasUnknown = o.items.some((i) => !i.known);

  $('#packContent').innerHTML = `
    <p class="pack-who">${esc(o.recipient.name)}님 · ${esc(o.recipient.address1)}</p>
    <p class="hint">상자에 하나 넣을 때마다 네모를 한 번씩 누르세요.</p>
    ${o.items.map((i) => {
      const n = Math.min(counts[i.productOrderId] || 0, i.quantity);
      return `
      <div class="pack-item${n >= i.quantity ? ' done' : ''}">
        <div class="pack-title">
          <span class="swatch" style="background:${esc(i.color)}"></span>
          <span>${esc(i.name)}</span>
          <span class="pack-count">${n} / ${i.quantity}</span>
        </div>
        ${i.known ? '' : '<p class="unknown">상품 목록에 없는 상품이에요. 주문 내용을 한 번 더 확인하세요.</p>'}
        <div class="taps">
          ${Array.from({ length: i.quantity }, (_, k) => `
            <button class="tap${k < n ? ' on' : ''}" type="button" style="${k < n ? `background:${esc(i.color)};border-color:${esc(i.color)}` : ''}"
              data-tap="${esc(i.productOrderId)}" data-index="${k}" aria-label="${esc(i.name)} ${k + 1}번째${k < n ? ' 넣음' : ''}">${k < n ? '✓' : k + 1}</button>`).join('')}
        </div>
      </div>`;
    }).join('')}
    <p class="pack-status${allDone ? ' ok' : ''}" role="status">
      ${allDone ? (hasUnknown ? '개수는 맞아요. 미등록 상품은 직접 확인하세요.' : '모두 맞아요! 상자를 닫아도 돼요.') : '아직 덜 넣었어요'}
    </p>
    ${o.packedAt
      ? '<button class="btn" id="unpack" type="button">포장 완료 취소</button>'
      : `<button class="btn ok" id="markPacked" type="button" ${allDone ? '' : 'disabled'}>포장 완료</button>`}
    <button class="undo" id="resetPack" type="button">처음부터 다시 세기</button>`;
}

$('#packContent').addEventListener('click', async (ev) => {
  const o = S.data.orders.find((x) => x.orderId === S.packingId);
  const tap = ev.target.closest('[data-tap]');
  if (tap) {
    const counts = (S.pack[o.orderId] ||= {});
    const idx = Number(tap.dataset.index);
    const cur = counts[tap.dataset.tap] || 0;
    // 빈 칸을 누르면 하나 추가, 채워진 칸을 누르면 그 칸부터 비움
    counts[tap.dataset.tap] = idx < cur ? idx : cur + 1;
    store.set('pack', S.pack);
    if (navigator.vibrate) navigator.vibrate(15);
    renderPack();
  }
  if (ev.target.id === 'resetPack') {
    delete S.pack[o.orderId];
    store.set('pack', S.pack);
    renderPack();
  }
  if (ev.target.id === 'markPacked' || ev.target.id === 'unpack') {
    const packed = ev.target.id === 'markPacked';
    if (!S.demo) await api(`/api/orders/${encodeURIComponent(o.orderId)}/packed`, { method: 'POST', body: { packed } });
    o.packedAt = packed ? new Date().toISOString() : null;
    render();
    if (packed) $('#packSheet').hidden = true;
    else renderPack();
  }
});

// ── 주문 고르기 (문자·라벨 공용) ────────────────
function renderPick(container, onChange) {
  const orders = S.data.orders;
  container.innerHTML = orders.length
    ? orders.map((o) => `
      <label><input type="checkbox" id="pick-${esc(container.id)}-${esc(o.orderId)}" value="${esc(o.orderId)}" checked>
        <span>${esc(o.recipient.name)} · ${o.items.map((i) => `${esc(i.name)} ×${i.quantity}`).join(', ')}</span></label>`).join('')
    : '<p class="empty">발송할 주문이 없어요.</p>';
  container.onchange = onChange;
}
const picked = (container) => {
  const ids = [...container.querySelectorAll('input:checked')].map((i) => i.value);
  return S.data.orders.filter((o) => ids.includes(o.orderId));
};

// ── 기사님 문자 ──────────────────────────────
function driverMessage(orders) {
  const { sender, senderPhone } = S.settings;
  const head = `안녕하세요${sender ? `, ${sender}입니다` : ''}. 오늘 택배 ${orders.length}건 부탁드립니다.`;
  const body = orders.map((o, n) => {
    const r = o.recipient;
    return [
      `[${n + 1}] ${r.name} ${r.phone}`,
      `(${r.zip}) ${fullAddress(r)}`,
      `품목: ${o.items.map((i) => `${i.name} ${i.quantity}개`).join(', ')}`,
      o.memo ? `메모: ${o.memo}` : '',
    ].filter(Boolean).join('\n');
  });
  const foot = sender || senderPhone ? `\n보내는 분: ${[sender, senderPhone].filter(Boolean).join(' ')}` : '';
  return `${head}\n\n${body.join('\n\n')}${foot}`;
}

function updateDriver() {
  const text = driverMessage(picked($('#driverPick')));
  $('#driverText').value = text;
  const num = (S.settings.driver || '').replace(/[^0-9]/g, '');
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  // 번호가 없으면 받는 사람 칸이 빈 채로 문자앱이 열려서, 연락처에서 기사님을 고르면 됩니다
  $('#smsDriver').href = `sms:${num}${isIOS ? '&' : '?'}body=${encodeURIComponent(text)}`;
  $('#driverTo').textContent = num
    ? `받는 사람: 기사님 ${S.settings.driver}. 문자앱이 열리면 보내기만 누르세요.`
    : '문자앱이 열리면 받는 사람에 기사님을 골라 보내세요. 설정에 번호를 저장해 두면 바로 채워져요.';
  $('#copied').hidden = true;
}

$('#openDriver').addEventListener('click', () => {
  renderPick($('#driverPick'), updateDriver);
  updateDriver();
  $('#driverSheet').hidden = false;
});

$('#copyDriver').addEventListener('click', async () => {
  const t = $('#driverText');
  try {
    await navigator.clipboard.writeText(t.value);
  } catch {
    t.select();
    document.execCommand?.('copy');
  }
  $('#copied').hidden = false;
});

// ── 설정 ────────────────────────────────────
function fillSettings() {
  $('#setSender').value = S.settings.sender || '';
  $('#setSenderPhone').value = S.settings.senderPhone || '';
  $('#setDriver').value = S.settings.driver || '';
}
// 연락처에서 고르기: 안드로이드 크롬만 지원 (아이폰 사파리는 미지원 → 버튼 숨김)
if ('contacts' in navigator && 'select' in navigator.contacts) {
  $('#pickDriver').hidden = false;
  $('#pickDriver').addEventListener('click', async () => {
    try {
      const [c] = await navigator.contacts.select(['name', 'tel'], { multiple: false });
      if (c?.tel?.[0]) $('#setDriver').value = c.tel[0];
    } catch { /* 취소 */ }
  });
}
$('#settingsForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  S.settings = {
    sender: $('#setSender').value.trim(),
    senderPhone: $('#setSenderPhone').value.trim(),
    driver: $('#setDriver').value.trim(),
  };
  store.set('settings', S.settings);
  $('#settingsSaved').hidden = false;
  setTimeout(() => { $('#settingsSaved').hidden = true; }, 2000);
});
$('#refresh').addEventListener('click', async () => {
  if (!S.demo) await api('/api/poll', { method: 'POST' }).catch(() => {});
  load();
});
$('#fakeOrder').addEventListener('click', async () => {
  await api('/api/dev/fake-order', { method: 'POST' });
  load();
});
$('#logout').addEventListener('click', () => {
  S.password = '';
  store.set('password', '');
  if (!S.demo) showLogin();
});

// ── 시작 ────────────────────────────────────
fillSettings();
load();
setInterval(() => { if (!document.hidden && !S.demo) load(); }, 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !S.demo) load(); });
