const { Sticker, StickerTypes } = require("wa-sticker-formatter");
const { downloadMediaMessage } = require("lily-baileys");
const { createStickerFromVideo, createStickerFromTGS, createStaticPreviewFromTGS } = require("../../lib/sticker.js");
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require("sharp");

const httpsAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 60000 });
const TEMP_DIR = path.join(__dirname, '../../temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

global.telegramStickerSessions = global.telegramStickerSessions || {};

function extractStickerPackName(url) {
  const m = url.match(/(?:https?:\/\/)?(?:www\.)?t\.me\/addstickers\/(.+)/);
  return m ? m[1] : null;
}

async function downloadTelegramFile(sticker, botToken) {
  const fileId = sticker.file_id;
  const info = await axios.get(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`, { httpsAgent });
  if (!info.data.ok) throw new Error(info.data.description);

  const filePath = info.data.result.file_path;
  const format = filePath.endsWith('.tgs') ? 'tgs'
    : filePath.endsWith('.webm') ? 'webm'
    : filePath.endsWith('.webp') ? 'webp'
    : filePath.endsWith('.mp4') ? 'mp4'
    : 'unknown';

  const bin = await axios.get(`https://api.telegram.org/file/bot${botToken}/${filePath}`, {
    responseType: 'arraybuffer', httpsAgent
  });

  return {
    buffer: Buffer.from(bin.data),
    format,
    isAnimated: sticker.is_animated || sticker.is_video,
    isWebm: sticker.is_video
  };
}

async function getTelegramStickerPack(name, botToken) {
  const r = await axios.get(`https://api.telegram.org/bot${botToken}/getStickerSet?name=${name}`);
  if (!r.data.ok) throw new Error(r.data.description);
  const set = r.data.result;

  let staticCount = 0, videoCount = 0, tgsCount = 0;
  set.stickers.forEach(s => {
    if (s.is_video) videoCount++;
    else if (s.is_animated) tgsCount++;
    else staticCount++;
  });

  return {
    title: set.title,
    name: set.name,
    stickers: set.stickers,
    thumb: set.thumb || null,
    staticCount, videoCount, tgsCount,
    totalCount: set.stickers.length
  };
}

/* ---------- Thumbnail helper ---------- */
async function generateThumbnail(packInfo, botToken) {
  // 1) thumb resmi
  if (packInfo.thumb?.file_id) {
    const t = await downloadTelegramFile(packInfo.thumb, botToken);
    return t.buffer;
  }
  // 2) sample statis
  const s = packInfo.stickers.find(x => !x.is_animated && !x.is_video);
  if (s) {
    const d = await downloadTelegramFile(s, botToken);
    return d.buffer;
  }
  // 3) sample animasi → statis (frame kosong transparan sebagai fallback ringan)
  const a = packInfo.stickers.find(x => x.is_animated || x.is_video);
  if (a) {
    const d = await downloadTelegramFile(a, botToken);
    if (d.format === 'tgs') return await createStaticPreviewFromTGS(d.buffer);
    // untuk webm/mp4, buat canvas kosong 512
    return await sharp({ create: { width: 512, height: 512, channels: 4, background: { r:0,g:0,b:0,alpha:0 } } }).png().toBuffer();
  }
  // 4) fallback akhir
  return await sharp({ create: { width: 512, height: 512, channels: 4, background: { r:0,g:0,b:0,alpha:0 } } }).png().toBuffer();
}

/* ---------- Kirim stiker + fallback & notifikasi ---------- */
async function convertAndSendSticker(bot, chatId, fileData, stickerTitle, quotedMsg) {
  const { buffer, format, isWebm } = fileData;
  if (!buffer?.length) throw new Error("Buffer kosong");

  const opts = {
    pack: process.env.stickerPackname || "Telegram Stiker",
    author: process.env.stickerAuthor || "Dari Telegram",
    type: StickerTypes.FULL,
    quality: 90,
    background: "transparent"
  };

  let sticker;
  try {
    if (format === 'tgs') {
      sticker = await createStickerFromTGS(buffer, opts);
    } else if (isWebm || format === 'mp4') {
      sticker = await createStickerFromVideo(buffer, opts);
    } else {
      sticker = new Sticker(buffer, { ...opts, background: "transparent" });
    }
  } catch (e) {
    // Fallback khusus TGS: kirim versi statis + info
    if (format === 'tgs') {
      try {
        const preview = await createStaticPreviewFromTGS(buffer);
        sticker = new Sticker(preview, { ...opts, type: StickerTypes.FULL, background: "transparent" });
        await bot.sendMessage(chatId, { text: `⚠️ ${stickerTitle}: animasi TGS gagal dikonversi, dikirim versi *statis*.` }, { quoted: quotedMsg });
      } catch (ee) {
        await bot.sendMessage(chatId, { text: `❌ ${stickerTitle}: gagal (TGS). ${e.message}` }, { quoted: quotedMsg });
        throw ee;
      }
    } else {
      await bot.sendMessage(chatId, { text: `❌ ${stickerTitle}: gagal. ${e.message}` }, { quoted: quotedMsg });
      throw e;
    }
  }

  await bot.sendMessage(chatId, await sticker.toMessage(), { quoted: quotedMsg });
  return true;
}

module.exports = {
  name: "sticker",
  alias: ["s"],
  description: "Ubah gambar/video/dokumen menjadi stiker, atau download sticker pack dari Telegram.",
  execute: async (msg, { bot, args }) => {
    const action = args[0];
    const telegramUrl = args[1];
    const { from, sender } = msg;

    // tombol pilihan
    if (msg.isGroup && msg.body && msg.body.startsWith('telegram_sticker_')) {
      const option = msg.body.replace('telegram_sticker_', '');
      return module.exports.downloadStickers(bot, msg, option);
    }

    // ambil pack dari Telegram
    if (action === '-get' && telegramUrl) {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) return msg.reply("❌ Telegram Bot Token tidak ditemukan.");
      const packName = extractStickerPackName(telegramUrl);
      if (!packName) return msg.reply("❌ URL tidak valid.");

      await msg.react("⏳");
      try {
        const packInfo = await getTelegramStickerPack(packName, botToken);
        global.telegramStickerSessions[sender] = { packInfo, botToken, timestamp: Date.now() };

        const thumbBuffer = await generateThumbnail(packInfo, botToken);

        const buttons = [
          { buttonId: `telegram_sticker_all`, buttonText: { displayText: `📦 Semua (${packInfo.totalCount})` }, type: 1 },
          { buttonId: `telegram_sticker_half`, buttonText: { displayText: `📦 ${Math.ceil(packInfo.totalCount/2)} Sticker` }, type: 1 },
          { buttonId: `telegram_sticker_quarter`, buttonText: { displayText: `📦 ${Math.ceil(packInfo.totalCount/4)} Sticker` }, type: 1 },
        ];
        if (packInfo.videoCount) buttons.push({ buttonId: `telegram_sticker_video`, buttonText: { displayText: `🎬 Video WebM (${packInfo.videoCount})` }, type: 1 });
        if (packInfo.tgsCount) buttons.push({ buttonId: `telegram_sticker_tgs`, buttonText: { displayText: `🎭 TGS Animasi (${packInfo.tgsCount})` }, type: 1 });
        if (packInfo.staticCount) buttons.push({ buttonId: `telegram_sticker_static`, buttonText: { displayText: `🖼️ Statis (${packInfo.staticCount})` }, type: 1 });

        await bot.sendMessage(from, {
          image: thumbBuffer,
          caption: `📦 *Sticker Pack Ditemukan!*\n\n🎯 *Nama:* ${packInfo.title}\n🔗 *Pack ID:* ${packInfo.name}\n\n📊 *Detail:*\n🖼️ Statis: ${packInfo.staticCount}\n🎬 Video: ${packInfo.videoCount}\n🎭 TGS: ${packInfo.tgsCount}\n📈 Total: ${packInfo.totalCount}\n\n❓ Pilih opsi download:`,
          footer: "Telegram Sticker Downloader",
          buttons,
          headerType: 4
        }, { quoted: msg });

        await msg.react("✅");
        setTimeout(() => { delete global.telegramStickerSessions[sender]; }, 5 * 60 * 1000);
      } catch (err) {
        console.error(err);
        await msg.react("⚠️");
        return msg.reply(`❌ Gagal mengambil sticker pack.\n${err.message}`);
      }
      return;
    }

    // konversi media biasa
    const targetMsg = msg.quoted || msg;
    const validTypes = ["imageMessage", "videoMessage", "documentMessage"];
    if (!validTypes.includes(targetMsg.type)) {
      return msg.reply("❌ Kirim atau reply media yang valid dengan caption `.s`.");
    }

    let isVideo = targetMsg.type === "videoMessage";
    if (targetMsg.type === "documentMessage") {
      const mimetype = targetMsg.msg?.mimetype || "";
      if (mimetype.includes("webm") || mimetype.includes("tgs") || mimetype.includes("mp4")) {
        isVideo = true;
      } else if (!mimetype.startsWith("image")) {
        return msg.reply("❌ Dokumen bukan gambar atau video.");
      }
    }

    await msg.react("⏳");
    try {
      const buffer = await downloadMediaMessage(
        targetMsg.isViewOnce ? targetMsg.raw : targetMsg,
        "buffer", {}, { reuploadRequest: bot.updateMediaMessage }
      );
      if (!buffer?.length) throw new Error("Media kosong");

      const opts = {
        pack: process.env.stickerPackname || "Bot Stiker",
        author: process.env.stickerAuthor || "Dibuat oleh Bot",
        type: StickerTypes.FULL,
        quality: 90,
        background: "transparent"
      };

      let sticker;
      if (targetMsg.msg?.mimetype?.includes("tgs")) {
        // .tgs: anim/fallback di-handle di createStickerFromTGS()
        sticker = await createStickerFromTGS(buffer, opts);
      } else if (isVideo) {
        sticker = await createStickerFromVideo(buffer, opts);
      } else {
        sticker = new Sticker(buffer, { ...opts, background: "transparent" });
      }

      await bot.sendMessage(from, await sticker.toMessage(), { quoted: msg });
      await msg.react("✅");
    } catch (err) {
      console.error(err);
      await msg.react("⚠️");
      return msg.reply(`❌ Gagal membuat stiker.\n${err.message}`);
    }
  },

  downloadStickers: async function (bot, msg, option) {
    const sessionData = global.telegramStickerSessions[msg.sender];
    if (!sessionData) return msg.reply("❌ Session expired.");

    const { packInfo, botToken } = sessionData;
    let list = [];
    switch (option) {
      case 'all': list = packInfo.stickers; break;
      case 'half': list = packInfo.stickers.slice(0, Math.ceil(packInfo.totalCount/2)); break;
      case 'quarter': list = packInfo.stickers.slice(0, Math.ceil(packInfo.totalCount/4)); break;
      case 'video': list = packInfo.stickers.filter(s => s.is_video); break;
      case 'tgs': list = packInfo.stickers.filter(s => s.is_animated && !s.is_video); break;
      case 'static': list = packInfo.stickers.filter(s => !s.is_animated && !s.is_video); break;
      default: return msg.reply("❌ Opsi tidak valid.");
    }

    for (let i = 0; i < list.length; i++) {
      const st = list[i];
      try {
        const fileData = await downloadTelegramFile(st, botToken);
        await convertAndSendSticker(bot, msg.from, fileData, `${packInfo.title} - ${i + 1}`, msg);
        await new Promise(r => setTimeout(r, (st.is_video || fileData.format === 'tgs') ? 4000 : 1500));
      } catch (err) {
        console.error(`Error sticker ${i + 1}:`, err.message);
        // Beri tahu user (singkat) lalu lanjut ke item berikutnya
        await bot.sendMessage(msg.from, { text: `⚠️ ${packInfo.title} #${i + 1} gagal: ${err.message}` }, { quoted: msg });
      }
    }

    delete global.telegramStickerSessions[msg.sender];
  }
};
