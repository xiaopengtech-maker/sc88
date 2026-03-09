// api/webhook.js — Telegram Bot Webhook v1.1

const TG_TOKEN = process.env.TG_BOT_TOKEN;
const PAY_API  = process.env.PAY_API_URL;

async function sendTelegram(chatId, text) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
  const d = await r.json();
  if (!d.ok) console.error("TG send error:", JSON.stringify(d));
  return d;
}

async function getPayInfo() {
  console.log("Step 1: Calling SC88 API...");
  console.log("PAY_API:", PAY_API ? PAY_API.substring(0, 60) + "..." : "NOT SET");

  const res1 = await fetch(PAY_API, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json, text/plain, */*",
      "Referer": "https://sc88.com/",
    },
  });

  const text1 = await res1.text();
  console.log("SC88 response status:", res1.status);
  console.log("SC88 response body:", text1.substring(0, 300));

  let data1;
  try { data1 = JSON.parse(text1); }
  catch(e) { throw new Error(`SC88 không trả về JSON: ${text1.substring(0,100)}`); }

  if (!data1.success || data1.code !== 0) {
    throw new Error(`SC88 lỗi: ${data1.msg || JSON.stringify(data1)}`);
  }

  const inner = data1.data;
  console.log("SC88 inner data:", JSON.stringify(inner).substring(0, 200));

  // Lấy params từ URL redirect
  let orderNo = inner.outTradeNo || inner.orderNo || "";
  let merchantCode = "";
  let timestamp = String(inner.createTime ? inner.createTime * 1000 : Date.now());
  let sign = "";

  const redirectUrl = inner.url || inner.data || "";
  if (redirectUrl) {
    try {
      const u = new URL(redirectUrl);
      orderNo      = u.searchParams.get("orderNo")      || orderNo;
      merchantCode = u.searchParams.get("merchantCode") || merchantCode;
      timestamp    = u.searchParams.get("timestamp")    || timestamp;
      sign         = u.searchParams.get("sign")         || sign;
      console.log("Parsed from URL:", { orderNo, merchantCode, timestamp, sign });
    } catch(e) {
      console.log("URL parse error:", e.message, "URL was:", redirectUrl);
    }
  }

  if (!merchantCode) {
    throw new Error(`Không lấy được merchantCode. redirectUrl: ${redirectUrl}`);
  }

  // Step 2: Query okpaypos
  console.log("Step 2: Querying okpaypos...");
  const payload = { orderNo, merchantCode, timestamp, sign };
  console.log("Payload:", JSON.stringify(payload));

  const res2 = await fetch("https://okpaypos.work/api/order/counter/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Origin": "https://okpaypos.work",
      "Referer": redirectUrl || "https://okpaypos.work/",
    },
    body: JSON.stringify(payload),
  });

  const text2 = await res2.text();
  console.log("okpaypos status:", res2.status);
  console.log("okpaypos body:", text2.substring(0, 400));

  let data2;
  try { data2 = JSON.parse(text2); }
  catch(e) { throw new Error(`okpaypos không trả về JSON: ${text2.substring(0,100)}`); }

  if (String(data2.code) !== "200") {
    throw new Error(`okpaypos lỗi code=${data2.code}: ${data2.message || JSON.stringify(data2)}`);
  }

  const d = data2.data;
  return {
    bankName:     d.bankName || d.vnBankName || "?",
    payeeName:    d.payeeName || "?",
    payeeAccount: d.payeeAccount || "?",
    amount:       d.amount || "?",
    identifier:   d.identifier || "?",
    orderNo:      d.orderNo || orderNo,
    status:       d.status || "?",
    qrCode:       d.payeeQrCode || "",
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ status: "Bot đang chạy ✅", version: "1.1" });
  }

  console.log("Webhook received:", JSON.stringify(req.body).substring(0, 200));

  try {
    const body = req.body || {};
    const msg  = body.message;
    if (!msg) return res.status(200).send("ok");

    const chatId = msg.chat.id;
    const text   = (msg.text || "").trim();

    console.log(`Message from ${chatId}: ${text}`);

    if (["/pay", "/nap", "/start"].includes(text.toLowerCase())) {
      await sendTelegram(chatId, "⏳ Đang lấy thông tin thanh toán...");

      try {
        const info = await getPayInfo();
        const amountFmt = Number(info.amount).toLocaleString("vi-VN");

        const reply =
          `💳 <b>THÔNG TIN NẠP TIỀN</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `🏦 <b>Ngân hàng:</b> ${info.bankName}\n` +
          `👤 <b>Tên TK:</b> <code>${info.payeeName}</code>\n` +
          `💳 <b>Số TK:</b> <code>${info.payeeAccount}</code>\n` +
          `💰 <b>Số tiền:</b> <code>${amountFmt} VND</code>\n` +
          `📝 <b>Nội dung CK:</b> <code>${info.identifier}</code>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `🔖 Order: <code>${info.orderNo}</code>\n` +
          `📊 Trạng thái: ${info.status === "WAIT_PAY" ? "⏳ Chờ thanh toán" : info.status}`;

        await sendTelegram(chatId, reply);

        if (info.qrCode) {
          await sendTelegram(chatId, `📱 <b>Mã QR:</b>\n<code>${info.qrCode}</code>`);
        }

      } catch(e) {
        console.error("getPayInfo error:", e.message);
        await sendTelegram(chatId, `❌ Lỗi lấy thông tin:\n<code>${e.message}</code>`);
      }

    } else if (text.toLowerCase() === "/help") {
      await sendTelegram(chatId,
        `🤖 <b>Bot Nạp Tiền SC88</b>\n\n` +
        `/pay hoặc /nap — Lấy thông tin tài khoản nạp\n` +
        `/help — Hướng dẫn`);
    }

  } catch(err) {
    console.error("Handler error:", err.message);
  }

  return res.status(200).send("ok");
}
