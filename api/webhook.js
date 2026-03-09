// api/webhook.js — Telegram Bot Webhook
// Nhận lệnh từ Telegram, gọi API lấy thông tin thanh toán

const TG_TOKEN = process.env.TG_BOT_TOKEN;
const PAY_API  = process.env.PAY_API_URL;   // URL đầy đủ của SC88 pay API

async function sendTelegram(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    }),
  });
}

async function getPayInfo() {
  // ── Bước 1: Gọi SC88 pay API ────────────────────
  const res1 = await fetch(PAY_API, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
    },
  });

  if (!res1.ok) throw new Error(`SC88 API lỗi: ${res1.status}`);
  const data1 = await res1.json();

  if (!data1.success || data1.code !== 0) {
    throw new Error(`SC88 trả về lỗi: ${data1.msg || JSON.stringify(data1)}`);
  }

  const { orderNo, merchantCode, outTradeNo } = data1.data;
  const timestamp = String(data1.data.createTime * 1000);

  // Lấy sign từ URL trong data
  let sign = "";
  try {
    const u = new URL(data1.data.url || data1.data.data);
    sign = u.searchParams.get("sign") || "";
    // Dùng timestamp từ URL nếu có
    const ts = u.searchParams.get("timestamp");
    if (ts) Object.assign({ timestamp: ts });
  } catch {}

  // ── Bước 2: Query okpaypos ───────────────────────
  const payload = { orderNo: outTradeNo, merchantCode, timestamp, sign };

  const res2 = await fetch("https://okpaypos.work/api/order/counter/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
      "Origin": "https://okpaypos.work",
      "Referer": "https://okpaypos.work/",
    },
    body: JSON.stringify(payload),
  });

  if (!res2.ok) throw new Error(`okpaypos lỗi: ${res2.status}`);
  const data2 = await res2.json();

  if (data2.code !== "200" && data2.code !== 200) {
    throw new Error(`okpaypos trả về: ${JSON.stringify(data2)}`);
  }

  const d = data2.data;
  return {
    bankName:      d.bankName      || d.vnBankName || "?",
    payeeName:     d.payeeName     || "?",
    payeeAccount:  d.payeeAccount  || "?",
    amount:        d.amount        || "?",
    identifier:    d.identifier    || "?",
    orderNo:       d.orderNo       || outTradeNo,
    status:        d.status        || "?",
    qrCode:        d.payeeQrCode   || "",
  };
}

export default async function handler(req, res) {
  // Chỉ nhận POST từ Telegram
  if (req.method !== "POST") {
    return res.status(200).send("Bot đang chạy ✅");
  }

  try {
    const body   = req.body || {};
    const msg    = body.message || body.callback_query?.message;
    if (!msg) return res.status(200).send("ok");

    const chatId  = msg.chat.id;
    const text    = (msg.text || "").trim().toLowerCase();
    const username = msg.from?.username || msg.from?.first_name || "User";

    // Lệnh /pay hoặc /nap
    if (text === "/pay" || text === "/nap" || text === "/start") {
      await sendTelegram(chatId, "⏳ Đang lấy thông tin thanh toán...");

      try {
        const info = await getPayInfo();

        const reply =
          `💳 <b>THÔNG TIN NẠP TIỀN</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `🏦 <b>Ngân hàng:</b> ${info.bankName}\n` +
          `👤 <b>Tên TK:</b> <code>${info.payeeName}</code>\n` +
          `💳 <b>Số TK:</b> <code>${info.payeeAccount}</code>\n` +
          `💰 <b>Số tiền:</b> <code>${Number(info.amount).toLocaleString("vi-VN")} VND</code>\n` +
          `📝 <b>Nội dung CK:</b> <code>${info.identifier}</code>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `🔖 Order: <code>${info.orderNo}</code>\n` +
          `📊 Trạng thái: ${info.status === "WAIT_PAY" ? "⏳ Chờ thanh toán" : info.status}`;

        await sendTelegram(chatId, reply);

        // Gửi thêm QR nếu có
        if (info.qrCode) {
          await sendTelegram(chatId,
            `📱 <b>Mã QR:</b>\n<code>${info.qrCode}</code>`);
        }

      } catch (e) {
        await sendTelegram(chatId, `❌ Lỗi: ${e.message}`);
      }

    } else if (text === "/help") {
      await sendTelegram(chatId,
        `🤖 <b>Bot Nạp Tiền SC88</b>\n\n` +
        `/pay — Lấy thông tin tài khoản nạp\n` +
        `/nap — (giống /pay)\n` +
        `/help — Hướng dẫn`);

    } else {
      // Bỏ qua các lệnh không biết
    }

  } catch (err) {
    console.error("Webhook error:", err);
  }

  return res.status(200).send("ok");
}
