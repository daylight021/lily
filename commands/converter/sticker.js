const { Sticker, StickerTypes } = require("wa-sticker-formatter");
const { downloadMediaMessage } = require("lily-baileys");
const { createStickerFromVideo } = require("../../lib/sticker.js");
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TEMP_DIR = path.join(__dirname, '../../temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Global session storage untuk menyimpan data sticker pack Telegram
global.telegramStickerSessions = global.telegramStickerSessions || {};

// Helper function untuk extract sticker pack name dari URL
function extractStickerPackName(url) {
    const match = url.match(/(?:https?:\/\/)?(?:www\.)?t\.me\/addstickers\/(.+)/);
    return match ? match[1] : null;
}

// Helper function untuk download file dari Telegram
async function downloadTelegramFile(fileId, botToken) {
    try {
        // Get file path from Telegram API
        const fileResponse = await axios.get(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
        if (!fileResponse.data.ok) {
            throw new Error(`Gagal mendapatkan file path: ${fileResponse.data.description}`);
        }
        
        const filePath = fileResponse.data.result.file_path;
        
        // Download file
        const downloadResponse = await axios.get(`https://api.telegram.org/file/bot${botToken}/${filePath}`, {
            responseType: 'arraybuffer'
        });
        
        return Buffer.from(downloadResponse.data);
    } catch (error) {
        throw new Error(`Error downloading file: ${error.message}`);
    }
}

// Function untuk mendapatkan sticker pack dari Telegram
async function getTelegramStickerPack(packName, botToken) {
    try {
        const response = await axios.get(`https://api.telegram.org/bot${botToken}/getStickerSet?name=${packName}`);
        
        if (!response.data.ok) {
            throw new Error(`Sticker pack tidak ditemukan: ${response.data.description}`);
        }
        
        const stickerSet = response.data.result;
        const stickers = stickerSet.stickers;
        
        let staticCount = 0;
        let animatedCount = 0;
        
        stickers.forEach(sticker => {
            if (sticker.is_animated || sticker.is_video) {
                animatedCount++;
            } else {
                staticCount++;
            }
        });
        
        return {
            title: stickerSet.title,
            name: stickerSet.name,
            stickers: stickers,
            staticCount: staticCount,
            animatedCount: animatedCount,
            totalCount: stickers.length
        };
    } catch (error) {
        throw new Error(`Error fetching sticker pack: ${error.message}`);
    }
}

// Function untuk konversi dan kirim sticker
async function convertAndSendSticker(bot, chatId, stickerBuffer, isAnimated, stickerTitle, quotedMsg) {
    try {
        let sticker;
        const stickerOptions = {
            pack: process.env.stickerPackname || "Telegram Stiker",
            author: process.env.stickerAuthor || "Dari Telegram",
            type: StickerTypes.FULL,
            quality: 90,
        };

        if (isAnimated) {
            // Untuk animated sticker, gunakan fungsi video
            console.log("Membuat animated sticker dari Telegram...");
            sticker = await createStickerFromVideo(stickerBuffer, stickerOptions);
        } else {
            // Untuk static sticker
            console.log("Membuat static sticker dari Telegram...");
            sticker = new Sticker(stickerBuffer, stickerOptions);
        }

        await bot.sendMessage(chatId, await sticker.toMessage(), { quoted: quotedMsg });
        return true;
    } catch (error) {
        console.error(`Error converting sticker "${stickerTitle}":`, error);
        return false;
    }
}

module.exports = {
  name: "sticker",
  alias: ["s"],
  description: "Ubah gambar/video/dokumen menjadi stiker, atau download sticker pack dari Telegram.",
  execute: async (msg, { bot, args }) => {
    const action = args[0]; // -get
    const telegramUrl = args[1]; // URL Telegram sticker pack
    
    // Handle Telegram sticker pack download
    if (action === '-get' && telegramUrl) {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      
      if (!botToken) {
        return msg.reply("❌ Telegram Bot Token tidak ditemukan. Pastikan TELEGRAM_BOT_TOKEN sudah diset di environment variables.\n\n" +
                        "📝 Cara mendapatkan token:\n" +
                        "1. Chat @BotFather di Telegram\n" +
                        "2. Ketik /newbot\n" +
                        "3. Ikuti instruksi untuk buat bot\n" +
                        "4. Copy token yang diberikan");
      }
      
      const packName = extractStickerPackName(telegramUrl);
      if (!packName) {
        return msg.reply("❌ Format URL tidak valid. Gunakan format: https://t.me/addstickers/packname\n\n" +
                        "Contoh: `.s -get https://t.me/addstickers/c1129234339_by_HarukaAyaBot`");
      }
      
      await msg.react("⏳");
      
      try {
        // Fetch sticker pack info
        const packInfo = await getTelegramStickerPack(packName, botToken);
        
        // Simpan data ke session
        global.telegramStickerSessions[msg.sender] = {
          packInfo: packInfo,
          botToken: botToken,
          timestamp: Date.now()
        };
        
        // Buat button confirmation
        const buttonMessage = {
          caption: `📦 *Sticker Pack Ditemukan!*\n\n` +
                  `🎯 *Nama:* ${packInfo.title}\n` +
                  `🔗 *Pack ID:* ${packInfo.name}\n\n` +
                  `📊 *Detail:*\n` +
                  `🖼️ Sticker biasa: ${packInfo.staticCount}\n` +
                  `🎬 Sticker animasi: ${packInfo.animatedCount}\n` +
                  `📈 Total sticker: ${packInfo.totalCount}\n\n` +
                  `❓ *Apakah kamu ingin mendapatkan semua stikernya?*\n` +
                  `⚠️ Proses ini akan memakan waktu tergantung jumlah sticker.`,
          footer: "Telegram Sticker Downloader",
          buttons: [{
            buttonId: `telegram_sticker_download`,
            buttonText: { displayText: "Aku mau" },
            type: 1
          }],
          headerType: 1
        };

        await bot.sendMessage(msg.from, buttonMessage, { quoted: msg });
        await msg.react("✅");
        
        // Set timeout untuk menghapus session setelah 5 menit
        setTimeout(() => {
          if (global.telegramStickerSessions && global.telegramStickerSessions[msg.sender]) {
            delete global.telegramStickerSessions[msg.sender];
          }
        }, 5 * 60 * 1000); // 5 menit
        
        return;
        
      } catch (error) {
        console.error("Error fetching Telegram sticker pack:", error);
        await msg.react("⚠️");
        
        let errorMessage = "❌ Gagal mengambil sticker pack dari Telegram.\n\n";
        
        if (error.message.includes('Unauthorized')) {
          errorMessage += "*Alasan:* Bot token tidak valid atau expired.\n" +
                         "Periksa kembali TELEGRAM_BOT_TOKEN.";
        } else if (error.message.includes('tidak ditemukan')) {
          errorMessage += "*Alasan:* Sticker pack tidak ditemukan.\n" +
                         "Pastikan URL dan nama pack benar.";
        } else {
          errorMessage += `*Alasan:* ${error.message}`;
        }
        
        return msg.reply(errorMessage);
      }
    }
    
    // Original sticker creation logic (unchanged)
    let targetMsg = msg.quoted || msg;
    
    const validTypes = ['imageMessage', 'videoMessage', 'documentMessage'];
    if (!validTypes.includes(targetMsg.type)) {
        return msg.reply("❌ Kirim atau reply media yang valid dengan caption `.s`.\n\n" +
                        "💡 *Fitur Telegram Sticker Pack:*\n" +
                        "• `.s -get <URL>` - Download sticker pack dari Telegram\n" +
                        "• Contoh: `.s -get https://t.me/addstickers/packname`");
    }

    let isVideo = targetMsg.type === 'videoMessage';
    if (targetMsg.type === 'documentMessage') {
        const mimetype = targetMsg.msg?.mimetype || '';
        if (mimetype.startsWith('video')) {
            isVideo = true;
        } else if (!mimetype.startsWith('image')) {
            return msg.reply("❌ Dokumen yang dikirim bukan gambar atau video.");
        }
    }

    await msg.react("⏳");
    try {
        const messageToDownload = targetMsg.isViewOnce ? targetMsg.raw : targetMsg;
        const buffer = await downloadMediaMessage(
            messageToDownload,
            "buffer",
            {},
            { reuploadRequest: bot.updateMediaMessage }
        );

        let sticker;
        const stickerOptions = {
            pack: process.env.stickerPackname || "Bot Stiker",
            author: process.env.stickerAuthor || "Dibuat oleh Bot",
            type: StickerTypes.FULL,
            quality: 90,
        };

        // --- GUNAKAN FUNGSI BERBEDA UNTUK VIDEO ---
        if (isVideo) {
            console.log("Membuat stiker dari video menggunakan logika kustom...");
            sticker = await createStickerFromVideo(buffer, stickerOptions);
        } else {
            console.log("Membuat stiker dari gambar menggunakan logika standar...");
            sticker = new Sticker(buffer, stickerOptions);
        }

        await bot.sendMessage(msg.from, await sticker.toMessage(), { quoted: msg });
        await msg.react("✅");

    } catch (err) {
      console.error("Kesalahan saat konversi stiker:", err);
      await msg.react("⚠️");
      // Memberikan pesan error yang lebih spesifik jika ffmpeg tidak ada
      if (err.message.includes('ffmpeg')) {
          return msg.reply("❌ Gagal membuat stiker video. Pastikan FFmpeg sudah terinstal di server.");
      }
      if (err.message.includes('too large')) {
          return msg.reply("❌ Gagal membuat stiker. Ukuran media terlalu besar.");
      }
      return msg.reply("❌ Gagal membuat stiker. Pastikan media valid.");
    }
  },
  
  // Function untuk handle download semua sticker (dipanggil dari CommandHandler)
  downloadAllStickers: async function(bot, msg) {
    const sessionData = global.telegramStickerSessions[msg.sender];
    if (!sessionData) {
      return msg.reply("❌ Session expired. Silakan kirim ulang perintah download sticker pack.");
    }
    
    const { packInfo, botToken } = sessionData;
    const stickers = packInfo.stickers;
    
    await msg.reply(`🚀 *Memulai download ${packInfo.totalCount} sticker...*\n\n` +
                   `📦 Pack: ${packInfo.title}\n` +
                   `⏱️ Estimasi waktu: ${Math.ceil(packInfo.totalCount * 2)} detik\n` +
                   `🔄 Proses dimulai...`);
    
    let successCount = 0;
    let failedCount = 0;
    
    for (let i = 0; i < stickers.length; i++) {
      const sticker = stickers[i];
      const stickerNum = i + 1;
      
      try {
        // Update progress setiap 5 sticker
        if (stickerNum % 5 === 0 || stickerNum === 1) {
          await bot.sendMessage(msg.from, {
            text: `📊 Progress: ${stickerNum}/${packInfo.totalCount} sticker...`
          });
        }
        
        // Download sticker dari Telegram
        const stickerBuffer = await downloadTelegramFile(sticker.file_id, botToken);
        
        // Tentukan apakah animated atau static
        const isAnimated = sticker.is_animated || sticker.is_video;
        
        // Konversi dan kirim sticker
        const success = await convertAndSendSticker(
          bot, 
          msg.from, 
          stickerBuffer, 
          isAnimated, 
          `Sticker ${stickerNum}`,
          msg
        );
        
        if (success) {
          successCount++;
        } else {
          failedCount++;
        }
        
        // Delay untuk anti-spam (1.5 detik per sticker)
        if (i < stickers.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
        
      } catch (error) {
        console.error(`Error processing sticker ${stickerNum}:`, error);
        failedCount++;
        
        // Jika error terlalu banyak, stop process
        if (failedCount > 5) {
          await msg.reply(`⚠️ Terlalu banyak error. Menghentikan proses.\n\n` +
                         `✅ Berhasil: ${successCount}\n` +
                         `❌ Gagal: ${failedCount}`);
          break;
        }
      }
    }
    
    // Summary
    await msg.reply(`🎉 *Download selesai!*\n\n` +
                   `📦 Pack: ${packInfo.title}\n` +
                   `✅ Berhasil: ${successCount}\n` +
                   `❌ Gagal: ${failedCount}\n` +
                   `📊 Total: ${packInfo.totalCount} sticker\n\n` +
                   `🙏 Terima kasih telah menggunakan layanan download sticker pack!`);
    
    // Clear session
    if (global.telegramStickerSessions[msg.sender]) {
      delete global.telegramStickerSessions[msg.sender];
    }
  }
};