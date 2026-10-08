import crypto from 'node:crypto';
import { config } from './config.js';

// 이름 가운데를 가립니다: 김하늘 → 김*늘
export function maskName(name = '') {
  if (name.length <= 1) return name;
  if (name.length === 2) return `${name[0]}*`;
  return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1];
}

export function orderSummary(orders) {
  return orders
    .slice(0, 5)
    .map((o) => `· ${maskName(o.recipient.name)}님 ${o.items.map((i) => `${i.name} ×${i.quantity}`).join(', ')}`)
    .join('\n') + (orders.length > 5 ? `\n· 외 ${orders.length - 5}건` : '');
}

// ── 알림 보내기 ─────────────────────────────
export async function notifyNewOrders(orders) {
  if (!orders.length) return;
  const text = `🔔 새 주문 ${orders.length}건\n${orderSummary(orders)}\n\n확인: ${config.appUrl}`;
  await send(text, config.solapi.templateOrder, {
    '#{건수}': String(orders.length),
    '#{내용}': orderSummary(orders),
    '#{링크}': config.appUrl,
  });
}

export async function notifyNewInquiries(inquiries) {
  if (!inquiries.length) return;
  const body = inquiries.slice(0, 3).map((q) => `· [${q.kind}] ${q.content.slice(0, 40)}`).join('\n');
  const text = `💬 새 문의 ${inquiries.length}건\n${body}\n\n스마트스토어센터에서 답변해 주세요.`;
  await send(text, config.solapi.templateInquiry, { '#{건수}': String(inquiries.length), '#{내용}': body });
}

async function send(text, templateId, variables) {
  if (config.notify === 'alimtalk') {
    try {
      return await sendAlimtalk(templateId, variables, text);
    } catch (e) {
      console.error('[notify] 알림톡 발송 실패:', e.message);
    }
  }
  console.log(`\n[알림]\n${text}\n`);
}

// ── 솔라피 알림톡 ───────────────────────────
// 템플릿은 카카오 검수를 통과한 문구와 변수(#{건수} 등)가 정확히 같아야 합니다.
// 알림톡이 실패하면 솔라피가 같은 내용을 문자(SMS/LMS)로 대신 보냅니다(disableSms: false).
async function sendAlimtalk(templateId, variables, fallbackText) {
  const s = config.solapi;
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString('hex');
  const signature = crypto.createHmac('sha256', s.apiSecret).update(date + salt).digest('hex');
  const messages = s.to.map((to) => ({
    to,
    from: s.from,
    text: fallbackText,
    kakaoOptions: { pfId: s.pfId, templateId, variables, disableSms: false },
  }));
  const res = await fetch('https://api.solapi.com/messages/v4/send-many/detail', {
    method: 'POST',
    headers: {
      Authorization: `HMAC-SHA256 apiKey=${s.apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) throw new Error(`솔라피 ${res.status}: ${await res.text()}`);
  console.log(`[notify] 알림톡 ${messages.length}건 요청 완료`);
}
