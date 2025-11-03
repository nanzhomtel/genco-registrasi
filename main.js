import axios from "axios";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";

dotenv.config();

const BOT_TOKEN = "8539090170:AAEJw9qVdM-ZyKl2Rek8QRa6f2xIiGIQ-SY";
const GENCO_BASE_URL = "https://appapigo.genconusantara.com/api/front";
const DEFAULT_INVITE = "DEQME8";

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log("🤖 Bot Telegram GencoPulsa aktif...");

// === Util umum ===
async function apiPost(endpoint, payload, headers = {}) {
  try {
    const res = await axios.post(`${GENCO_BASE_URL}${endpoint}`, payload, { headers });
    return res.data;
  } catch (err) {
    if (err.response) return err.response.data;
    return { code: 500, message: "Request error" };
  }
}

// === API ===
async function sendOtpApi(phone, inviteCode = DEFAULT_INVITE) {
  const payload = { phone, invite_code: inviteCode };
  const headers = {
    "Content-Type": "application/json",
    Origin: "https://genconusantara.com",
    Referer: "https://genconusantara.com/",
  };
  return await apiPost("/sendCode", payload, headers);
}

async function loginWithOtpApi(phone, otp, inviteCode = DEFAULT_INVITE) {
  const payload = { phone, captcha: otp, invite_code: inviteCode };
  const headers = {
    "Content-Type": "application/json",
    Origin: "https://genconusantara.com",
    Referer: "https://genconusantara.com/",
  };
  return await apiPost("/login/mobile", payload, headers);
}

async function getUserInfo(token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  return await apiPost("/userInfo", {}, headers);
}

// === STATE ===
const userState = {};
const userSession = {}; // simpan token login

// === /start ===
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  userState[chatId] = { step: "start" };

  bot.sendMessage(
    chatId,
    `👋 *Selamat datang di GencoPulsa Bot!*\n\nKode referral otomatis: *${DEFAULT_INVITE}*\n\nKlik tombol di bawah untuk mulai.`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🚀 Login / Daftar", callback_data: "start_process" }],
        ],
      },
    }
  );
});

// === CALLBACK ===
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const state = userState[chatId] || {};

  if (data === "start_process") {
    state.step = "phone";
    userState[chatId] = state;
    return bot.sendMessage(chatId, "📱 Silakan kirim nomor HP kamu (contoh: 081234567890)");
  }

  if (data === "send_otp" && state.phone) {
    const res = await sendOtpApi(state.phone);
    if (res.code === 200 || res.success) {
      state.step = "otp";
      bot.sendMessage(chatId, "✅ OTP dikirim! Kirimkan kode OTP (6 digit).");
    } else {
      bot.sendMessage(chatId, `⚠️ Gagal kirim OTP:\n${JSON.stringify(res)}`);
    }
  }
});

// === PESAN USER ===
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!userState[chatId]) return;
  const state = userState[chatId];

  try {
    // Step 1: input nomor HP
    if (state.step === "phone" && !text.startsWith("/")) {
      state.phone = text;
      return bot.sendMessage(chatId, `Nomor kamu: *${text}*`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "📤 Kirim OTP", callback_data: "send_otp" }]],
        },
      });
    }

    // Step 2: input OTP
    if (state.step === "otp" && !text.startsWith("/")) {
      const otp = text;
      const res = await loginWithOtpApi(state.phone, otp);
      if (res.code === 200 || res.success) {
        const token = res.data?.token || res.token;
        userSession[chatId] = { token, phone: state.phone };

        bot.sendMessage(
          chatId,
          `🎉 Login berhasil!\n\n📞 Nomor: ${state.phone}\n\nGunakan perintah:\n- /cekuser → lihat info akun\n- /gantiuser → logout & login ulang`,
          { parse_mode: "Markdown" }
        );
      } else {
        bot.sendMessage(chatId, `⚠️ Gagal login:\n${JSON.stringify(res)}`);
      }
      delete userState[chatId];
      return;
    }
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "⚠️ Terjadi kesalahan server.");
  }
});

// === /cekuser ===
bot.onText(/\/cekuser/, async (msg) => {
  const chatId = msg.chat.id;
  const session = userSession[chatId];
  if (!session?.token)
    return bot.sendMessage(chatId, "⚠️ Kamu belum login! Gunakan /start untuk login dulu.");

  const res = await getUserInfo(session.token);
  if (res.code === 200 || res.success) {
    bot.sendMessage(
      chatId,
      `👤 *Info Akun:*\n📱 Nomor: ${session.phone}\n💰 Saldo: Rp${res.data?.money || 0}`,
      { parse_mode: "Markdown" }
    );
  } else {
    bot.sendMessage(chatId, `⚠️ Gagal ambil data:\n${JSON.stringify(res)}`);
  }
});

// === /gantiuser ===
bot.onText(/\/gantiuser/, async (msg) => {
  const chatId = msg.chat.id;

  // hapus sesi lama
  delete userSession[chatId];
  delete userState[chatId];

  userState[chatId] = { step: "phone" };
  bot.sendMessage(chatId, "🔄 Kamu telah keluar. Silakan kirim nomor HP baru untuk login ulang:");
});
