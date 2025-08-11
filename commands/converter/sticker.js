const { Sticker, StickerTypes } = require("wa-sticker-formatter");
const { downloadMediaMessage } = require("lily-baileys");
const { createStickerFromVideo, createStickerFromTGS } = require("../../lib/sticker.js");
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

// Helper function untuk download file dari Telegram dengan format yang tepat
async function downloadTelegramFile(sticker, botToken) {
    try {
        const fileId = sticker.file_id;
        
        const fileInfoResponse = await axios.get(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`, {
            timeout: 10000
        });
        
        if (!fileInfoResponse.data.ok) {
            throw new Error(`Gagal mendapatkan file info: ${fileInfoResponse.data.description}`);
        }

        const fileInfo = fileInfoResponse.data.result;
        const filePath = fileInfo.file_path;
        const fileSize = fileInfo.file_size || 0;
        
        console.log(`File info - Path: ${filePath}, Size: ${fileSize} bytes`);

        let actualFormat = 'unknown';
        if (filePath.endsWith('.webm')) {
            actualFormat = 'webm';
        } else if (filePath.endsWith('.tgs')) {
            actualFormat = 'tgs';
        } else if (filePath.endsWith('.webp')) {
            actualFormat = 'webp';
        } else if (filePath.endsWith('.mp4')) {
            actualFormat = 'mp4';
        }

        if (fileSize > 10 * 1024 * 1024) {
            throw new Error(`File terlalu besar: ${fileSize} bytes`);
        }

        const maxRetries = 3;
        let lastError;
        
        for (let i = 0; i < maxRetries; i++) {
            try {
                console.log(`Download attempt ${i + 1}/${maxRetries}`);
                
                const downloadResponse = await axios.get(`https://api.telegram.org/file/bot${botToken}/${filePath}`, {
                    responseType: 'arraybuffer',
                    timeout: 30000,
                    maxContentLength: 10 * 1024 * 1024
                });

                const buffer = Buffer.from(downloadResponse.data);
                
                if (buffer.length === 0) {
                    throw new Error("Downloaded file is empty");
                }
                
                return {
                    buffer: buffer,
                    format: actualFormat,
                    size: buffer.length,
                    isAnimated: sticker.is_animated || sticker.is_video,
                    isWebm: sticker.is_video
                };
                
            } catch (downloadError) {
                console.error(`Download attempt ${i + 1} failed:`, downloadError.message);
                lastError = downloadError;
                
                if (i < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
                }
            }
        }
        
        throw lastError;

    } catch (error) {
        console.error("Error downloading Telegram file:", error);
        throw new Error(`Error downloading file: ${error.message}`);
    }
}

// Function untuk mendapatkan sticker pack dari Telegram
async function getTelegramStickerPack(packName, botToken) {
    try {
        const response = await axios.get(`https://api.telegram.org/bot${botToken}/getStickerSet?name=${packName}`, {
            timeout: 15000
        });

        if (!response.data.ok) {
            throw new Error(`Sticker pack tidak ditemukan: ${response.data.description}`);
        }

        const stickerSet = response.data.result;
        const stickers = stickerSet.stickers;

        let staticCount = 0;
        let videoCount = 0;
        let tgsCount = 0;
        
        stickers.forEach(sticker => {
            if (sticker.is_video) {
                videoCount++;
            } else if (sticker.is_animated) {
                tgsCount++;
            } else {
                staticCount++;
            }
        });
        
        return {
            title: stickerSet.title,
            name: stickerSet.name,
            stickers: stickers,
            staticCount: staticCount,
            videoCount: videoCount,
            tgsCount: tgsCount,
            totalCount: stickers.length,
        };
    } catch (error) {
        throw new Error(`Error fetching sticker pack: ${error.message}`);
    }
}

// Function untuk konversi dan kirim sticker
async function convertAndSendSticker(bot, chatId, fileData, stickerTitle, quotedMsg) {
    try {
        const { buffer, format, isWebm } = fileData;
        
        if (!buffer || buffer.length === 0) {
            throw new Error("Buffer sticker kosong");
        }
        
        let sticker;
        const stickerOptions = {
            pack: process.env.stickerPackname || "Telegram Stiker",
            author: process.env.stickerAuthor || "Dari Telegram",
            type: StickerTypes.FULL,
            quality: 90,
            background: 'transparent',
            preserveTransparency: true
        };

        if (format === 'tgs') {
            console.log("Creating animated sticker from TGS...");
            try {
                sticker = await createStickerFromTGS(buffer, stickerOptions);
            } catch (tgsError) {
                console.error("TGS animated sticker creation failed:", tgsError);
                throw tgsError;
            }
        } else if (isWebm) {
            console.log("Creating animated sticker from WebM...");
            try {
                sticker = await createStickerFromVideo(buffer, stickerOptions);
            } catch (animatedError) {
                console.error("WebM animated sticker creation failed:", animatedError);
                console.log("Trying static sticker as fallback...");
                sticker = new Sticker(buffer, {
                    ...stickerOptions,
                    background: 'transparent'
                });
            }
        } else {
            console.log("Creating static sticker...");
            sticker = new Sticker(buffer, {
                ...stickerOptions,
                background: 'transparent'
            });
        }

        const stickerMessage = await sticker.toMessage();
        
        if (!stickerMessage || !stickerMessage.sticker) {
            throw new Error("Sticker message creation failed");
        }

        await bot.sendMessage(chatId, stickerMessage, { quoted: quotedMsg });
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
    const action = args[0];
    const telegramUrl = args[1];
    const { from, sender } = msg;

    // Handle button response
    if (msg.isGroup && msg.body && msg.body.startsWith('telegram_sticker_')) {
      const option = msg.body.replace('telegram_sticker_', '');
      return module.exports.downloadStickers(bot, msg, option);
    }
    
    if (action === '-get' && telegramUrl) {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;

      if (!botToken) {
        return msg.reply("❌ Telegram Bot Token tidak ditemukan. Pastikan TELEGRAM_BOT_TOKEN sudah diset di environment variables.");
      }

      const packName = extractStickerPackName(telegramUrl);
      if (!packName) {
        return msg.reply("❌ Format URL tidak valid. Gunakan format: https://t.me/addstickers/packname");
      }

      await msg.react("⏳");

      try {
        const packInfo = await getTelegramStickerPack(packName, botToken);
        const firstSticker = packInfo.stickers[0];

        let thumbnailBuffer = null;
        try {
            if (firstSticker) {
                const thumbnailData = await downloadTelegramFile(firstSticker, botToken);
                thumbnailBuffer = thumbnailData.buffer;
            }
        } catch (downloadError) {
            console.error("Gagal mendownload thumbnail:", downloadError);
        }

        global.telegramStickerSessions[sender] = {
          packInfo: packInfo,
          botToken: botToken,
          timestamp: Date.now()
        };

        const totalProcessable = packInfo.totalCount;
        const halfCount = Math.ceil(totalProcessable / 2);
        const quarterCount = Math.ceil(totalProcessable / 4);

        const buttons = [
          {
            buttonId: `telegram_sticker_all`,
            buttonText: { displayText: `📦 Semua (${totalProcessable})` },
            type: 1
          },
          {
            buttonId: `telegram_sticker_half`,
            buttonText: { displayText: `📦 ${halfCount} Sticker` },
            type: 1
          },
          {
            buttonId: `telegram_sticker_quarter`,
            buttonText: { displayText: `📦 ${quarterCount} Sticker` },
            type: 1
          }
        ];

        if (packInfo.videoCount > 0) {
          buttons.push({
            buttonId: `telegram_sticker_video`,
            buttonText: { displayText: `🎬 Video WebM (${packInfo.videoCount})` },
            type: 1
          });
        }
        
        if (packInfo.tgsCount > 0) {
            buttons.push({
                buttonId: `telegram_sticker_tgs`,
                buttonText: { displayText: `🎭 TGS Animasi (${packInfo.tgsCount})` },
                type: 1
            });
        }

        if (packInfo.staticCount > 0) {
          buttons.push({
            buttonId: `telegram_sticker_static`,
            buttonText: { displayText: `🖼️ Statis (${packInfo.staticCount})` },
            type: 1
          });
        }
        
        let caption = `📦 *Sticker Pack Ditemukan!*\n\n` +
                      `🎯 *Nama:* ${packInfo.title}\n` +
                      `🔗 *Pack ID:* ${packInfo.name}\n\n` +
                      `📊 *Detail:*\n` +
                      `🖼️ Sticker statis: ${packInfo.staticCount}\n` +
                      `🎬 Video sticker (WebM): ${packInfo.videoCount}\n` +
                      `🎭 TGS Animasi: ${packInfo.tgsCount}\n` +
                      `📈 Total sticker: ${packInfo.totalCount}\n\n` +
                      `❓ *Pilih opsi download:*\n` +
                      `🎨 Semua sticker akan diproses dengan background transparan.`;

        const buttonMessage = {
          caption: caption,
          footer: "Telegram Sticker Downloader",
          buttons: buttons,
          headerType: 4
        };

        if (thumbnailBuffer) {
            buttonMessage.image = thumbnailBuffer;
            buttonMessage.headerType = 4;
        }

        await bot.sendMessage(from, buttonMessage, { quoted: msg });
        await msg.react("✅");

        setTimeout(() => {
          if (global.telegramStickerSessions && global.telegramStickerSessions[sender]) {
            delete global.telegramStickerSessions[sender];
          }
        }, 5 * 60 * 1000);

        return;

      } catch (error) {
        console.error("Error fetching Telegram sticker pack:", error);
        await msg.react("⚠️");

        let errorMessage = "❌ Gagal mengambil sticker pack dari Telegram.\n\n";
        if (error.message.includes('Unauthorized')) {
          errorMessage += "*Alasan:* Bot token tidak valid atau expired.";
        } else if (error.message.includes('tidak ditemukan')) {
          errorMessage += "*Alasan:* Sticker pack tidak ditemukan.";
        } else {
          errorMessage += `*Alasan:* ${error.message}`;
        }
        return msg.reply(errorMessage);
      }
    }

    let targetMsg = msg.quoted || msg;
    const validTypes = ['imageMessage', 'videoMessage', 'documentMessage'];
    if (!validTypes.includes(targetMsg.type)) {
        return msg.reply("❌ Kirim atau reply media yang valid dengan caption `.s`.\n\n" +
                        "💡 *Fitur Telegram Sticker Pack:*\n" +
                        "• `.s -get <URL>` - Download sticker pack dari Telegram\n" +
                        "• Contoh: `.s -get https://t.me/addstickers/packname`\n\n" +
                        "🎨 Support format: WebM (video transparan), WebP (statis), TGS (animasi), gambar biasa");
    }

    let isVideo = targetMsg.type === 'videoMessage';
    if (targetMsg.type === 'documentMessage') {
        const mimetype = targetMsg.msg?.mimetype || '';
        if (mimetype.startsWith('video') || mimetype.includes('webm') || mimetype.includes('tgs')) {
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

        if (!buffer || buffer.length === 0) {
            throw new Error("Gagal mendownload media atau file kosong");
        }

        let sticker;
        const stickerOptions = {
            pack: process.env.stickerPackname || "Bot Stiker",
            author: process.env.stickerAuthor || "Dibuat oleh Bot",
            type: StickerTypes.FULL,
            quality: 90,
            background: 'transparent',
            preserveTransparency: true
        };

        if (isVideo) {
            sticker = await createStickerFromVideo(buffer, stickerOptions);
        } else {
            sticker = new Sticker(buffer, {
                ...stickerOptions,
                background: 'transparent'
            });
        }

        await bot.sendMessage(from, await sticker.toMessage(), { quoted: msg });
        await msg.react("✅");

    } catch (err) {
      console.error("Error creating sticker:", err);
      await msg.react("⚠️");
      
      let errorMessage = "❌ Gagal membuat stiker. ";
      
      if (err.message.includes('ffmpeg')) {
          errorMessage += "Pastikan FFmpeg sudah terinstal di server.";
      } else if (err.message.includes('too large') || err.message.includes('terlalu besar')) {
          errorMessage += "Ukuran media terlalu besar.";
      } else if (err.message.includes('Invalid data') || err.message.includes('rusak')) {
          errorMessage += "File media rusak atau format tidak didukung.";
      } else if (err.message.includes('kosong')) {
          errorMessage += "File media kosong atau tidak valid.";
      } else {
          errorMessage += "Pastikan media valid dan coba lagi.";
      }
      
      return msg.reply(errorMessage);
    }
  },

  downloadStickers: async function(bot, msg, option) {
    const sessionData = global.telegramStickerSessions[msg.sender];
    if (!sessionData) {
      return msg.reply("❌ Session expired. Silakan kirim ulang perintah download sticker pack.");
    }

    const { packInfo, botToken } = sessionData;
    let stickersToDownload = [];
    let optionText = "";

    switch (option) {
      case 'all':
        stickersToDownload = packInfo.stickers;
        optionText = `semua ${packInfo.totalCount} sticker`;
        break;
      
      case 'half':
        const halfCount = Math.ceil(packInfo.totalCount / 2);
        stickersToDownload = packInfo.stickers.slice(0, halfCount);
        optionText = `${halfCount} sticker`;
        break;
      
      case 'quarter':
        const quarterCount = Math.ceil(packInfo.totalCount / 4);
        stickersToDownload = packInfo.stickers.slice(0, quarterCount);
        optionText = `${quarterCount} sticker`;
        break;
      
      case 'video':
        stickersToDownload = packInfo.stickers.filter(s => s.is_video);
        optionText = `${stickersToDownload.length} video sticker (WebM)`;
        break;
      
      case 'tgs':
        stickersToDownload = packInfo.stickers.filter(s => s.is_animated && !s.is_video);
        optionText = `${stickersToDownload.length} TGS Animasi`;
        break;
      
      case 'static':
        stickersToDownload = packInfo.stickers.filter(s => !s.is_animated && !s.is_video);
        optionText = `${stickersToDownload.length} sticker statis`;
        break;
      
      default:
        return msg.reply("❌ Opsi download tidak valid.");
    }

    if (stickersToDownload.length === 0) {
      return msg.reply(`❌ Tidak ada sticker untuk opsi "${option}" yang dipilih.`);
    }

    let statusMessage = `🚀 *Memulai download ${optionText}...*\n\n` +
                       `📦 Pack: ${packInfo.title}\n` +
                       `⏱️ Estimasi waktu: ${Math.ceil(stickersToDownload.length * 5)} detik\n` +
                       `🎨 Background transparan: ✅\n` +
                       `🔄 Proses dimulai...\n`;

    await bot.sendMessage(msg.from, { text: statusMessage });

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < stickersToDownload.length; i++) {
      const sticker = stickersToDownload[i];
      const stickerNum = i + 1;

      try {
        if (stickerNum % 3 === 0 || stickerNum === 1) {
          const stickerType = sticker.is_video ? 'Video WebM' : 
                              (sticker.is_animated && !sticker.is_video) ? 'TGS Animasi' : 'Static WebP';
          
          await bot.sendMessage(msg.from, {
            text: `📊 Progress: ${stickerNum}/${stickersToDownload.length}\n` +
                  `✅ Berhasil: ${successCount} | ❌ Gagal: ${failedCount} | ⏭️ Skip: ${skippedCount}\n` +
                  `🎬 Sedang memproses: ${stickerType}`
          });
        }

        let fileData;
        try {
          fileData = await downloadTelegramFile(sticker, botToken);
        } catch (downloadError) {
          console.error(`Download failed for sticker ${stickerNum}:`, downloadError);
          failedCount++;
          continue;
        }

        if (!fileData || !fileData.buffer || fileData.buffer.length === 0) {
          console.error(`Empty file data for sticker ${stickerNum}`);
          failedCount++;
          continue;
        }

        if (fileData.size > 8 * 1024 * 1024) {
          console.log(`Skipping oversized sticker ${stickerNum}: ${fileData.size} bytes`);
          skippedCount++;
          continue;
        }

        const success = await convertAndSendSticker(
          bot,
          msg.from,
          fileData,
          `${packInfo.title} - Sticker ${stickerNum}`,
          msg
        );

        if (success) {
          successCount++;
        } else {
          failedCount++;
        }

        if (i < stickersToDownload.length - 1) {
          const delay = (sticker.is_video || (sticker.is_animated && !sticker.is_video)) ? 5000 : 2000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }

      } catch (error) {
        console.error(`Unexpected error processing sticker ${stickerNum}:`, error);
        failedCount++;

        if (failedCount > Math.ceil(stickersToDownload.length * 0.6)) {
          await msg.reply(`⚠️ Terlalu banyak error (>60%). Menghentikan proses.\n\n` +
                         `✅ Berhasil: ${successCount}\n` +
                         `❌ Gagal: ${failedCount}\n` +
                         `⏭️ Dilewati: ${skippedCount}`);
          break;
        }
      }
    }

    const totalProcessed = successCount + failedCount;
    const successRate = totalProcessed > 0 ? Math.round((successCount / totalProcessed) * 100) : 0;
    
    await msg.reply(`🎉 *Download selesai!*\n\n` +
                   `📦 Pack: ${packInfo.title}\n` +
                   `🎯 Opsi: ${optionText}\n` +
                   `✅ Berhasil: ${successCount}\n` +
                   `❌ Gagal: ${failedCount}\n` +
                   `⏭️ Dilewati: ${skippedCount} (Oversized)\n` +
                   `📊 Total diproses: ${stickersToDownload.length}\n` +
                   `📈 Success rate: ${successRate}%\n\n` +
                   `🎨 Format didukung: WebM (video), TGS (animasi), WebP (statis), gambar biasa\n` +
                   `🙏 Terima kasih telah menggunakan layanan download!`);

    if (global.telegramStickerSessions[msg.sender]) {
      delete global.telegramStickerSessions[msg.sender];
    }
  },

  downloadAllStickers: async function(bot, msg) {
    return this.downloadStickers(bot, msg, 'all');
  }
};
