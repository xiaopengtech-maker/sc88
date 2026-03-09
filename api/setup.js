// api/setup.js — Chạy 1 lần để đăng ký webhook với Telegram
// Truy cập: https://your-app.vercel.app/api/setup

export default async function handler(req, res) {
  const token      = process.env.TG_BOT_TOKEN;
  const vercelUrl  = process.env.VERCEL_URL || req.headers.host;
  const webhookUrl = `https://${vercelUrl}/api/webhook`;

  if (!token) {
    return res.status(500).json({ error: "TG_BOT_TOKEN chưa set trong env" });
  }

  try {
    // Xóa webhook cũ
    await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);

    // Đăng ký webhook mới
    const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ["message"],
        drop_pending_updates: true,
      }),
    });

    const data = await r.json();

    // Lấy thông tin bot
    const meR = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const me  = await meR.json();

    return res.status(200).json({
      webhook: data,
      webhookUrl,
      bot: me.result,
      status: data.ok ? "✅ Webhook đã đăng ký!" : "❌ Thất bại",
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
