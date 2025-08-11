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

// Function untuk mendapatkan format file yang tepat dari Telegram
function getTelegramFileFormat(sticker) {
  // Untuk animated sticker, Telegram menyediakan beberapa format
  if (sticker.is_animated) {
    return 'tgs'; // Telegram animated sticker (Lottie)
  } else if (sticker.is_video) {
    return 'webm'; // Video sticker (WebM dengan transparency)
  } else {
    return 'webp'; // Static sticker (WebP)
  }
}

// Helper function untuk download file dari Telegram dengan format yang tepat
async function downloadTelegramFile(sticker, botToken) {
    try {
        const format = getTelegramFileFormat(sticker);
        console.log(`Downloading Telegram sticker: ${sticker.file_id}, format: ${format}, animated: ${sticker.is_animated}, video: ${sticker.is_video}`);
        
        // Untuk video sticker, gunakan file_id utama yang biasanya WebM
        // Untuk animated sticker (TGS), gunakan file_id utama
        // Untuk static, gunakan file_id utama yang biasanya WebP
        const fileId = sticker.file_id;
        
        // Get file info terlebih dahulu
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
        
        // Deteksi format berdasarkan ekstensi file path
        let actualFormat = 'unknown';
        if (filePath.endsWith('.webm')) {
            actualFormat = 'webm';
        } else if (filePath.endsWith('.tgs')) {
            actualFormat = 'tgs';
        } else if (filePath.endsWith('.webp')) {
            actualFormat = 'webp';
        } else if (filePath.endsWith('.mp4')) {
            actualFormat = 'mp4'; // Jarang, tapi mungkin
        }
        
        console.log(`Actual file format from path: ${actualFormat}`);

        // Validasi ukuran file
        if (fileSize > 10 * 1024 * 1024) { // 10MB limit
            throw new Error(`File terlalu besar: ${fileSize} bytes`);
        }

        // Download file dengan retry mechanism
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
                
                // Validasi buffer
                if (buffer.length === 0) {
                    throw new Error("Downloaded file is empty");
                }
                
                // Validasi header untuk memastikan format yang benar
                const header = buffer.toString('hex', 0, 12).toLowerCase();
                let detectedFormat = 'unknown';
                
                if (header.startsWith('1a45dfa3')) {
                    detectedFormat = 'webm';
                } else if (buffer.toString('utf8', 0, 10).includes('{')) {
                    detectedFormat = 'tgs'; // Lottie JSON
                } else if (header.includes('52494646') && buffer.toString('ascii', 8, 12) === 'WEBP') {
                    detectedFormat = 'webp';
                } else if (header.includes('66747970')) {
                    detectedFormat = 'mp4';
                }
                
                console.log(`File downloaded successfully: ${buffer.length} bytes, detected format: ${detectedFormat}`);
                
                // Return buffer dengan metadata format
                return {
                    buffer: buffer,
                    format: detectedFormat,
                    size: buffer.length,
                    isAnimated: sticker.is_animated || sticker.is_video,
                    originalFormat: actualFormat
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
        let animatedCount = 0;
        let videoCount = 0;
        let tgsCount = 0;

        stickers.forEach(sticker => {
            if (sticker.is_animated) {
                tgsCount++;
                animatedCount++;
            } else if (sticker.is_video) {
                videoCount++;
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
            videoCount: videoCount,
            tgsCount: tgsCount,
            totalCount: stickers.length
        };
    } catch (error) {
        throw new Error(`Error fetching sticker pack: ${error.message}`);
    }
}

// Function untuk konversi dan kirim sticker dengan support WebM
async function convertAndSendSticker(bot, chatId, fileData, stickerTitle, quotedMsg) {
    try {
        const { buffer, format, isAnimated } = fileData;
        console.log(`Converting sticker: ${stickerTitle} (format: ${format}, animated: ${isAnimated})`);
        
        // Validasi buffer
        if (!buffer || buffer.length === 0) {
            throw new Error("Buffer sticker kosong");
        }
        
        if (buffer.length < 50) {
            throw new Error("Buffer sticker terlalu kecil, kemungkinan rusak");
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

        // Handle berdasarkan format file
        if (format === 'tgs') {
            // TGS (Telegram animated sticker) - Lottie format
            console.log("TGS format detected - currently not supported");
            throw new Error("TGS animated stickers are not supported yet");
            
        } else if (format === 'webm' || (isAnimated && format !== 'webp')) {
            // WebM video sticker (supports transparency)
            console.log("Creating animated sticker from WebM...");
            
            try {
                sticker = await createStickerFromVideo(buffer, stickerOptions);
            } catch (animatedError) {
                console.error("WebM animated sticker creation failed:", animatedError);
                
                // Fallback: coba sebagai sticker static
                console.log("Trying static sticker as fallback...");
                sticker = new Sticker(buffer, {
                    ...stickerOptions,
                    background: 'transparent'
                });
            }
            
        } else if (format === 'webp' || !isAnimated) {
            // Static WebP sticker
            console.log("Creating static sticker from WebP...");
            sticker = new Sticker(buffer, {
                ...stickerOptions,
                background: 'transparent'
            });
            
        } else {
            // Unknown format, try as video first, then static
            console.log(`Unknown format (${format}), trying as video...`);
            
            try {
                sticker = await createStickerFromVideo(buffer, stickerOptions);
            } catch (videoError) {
                console.log("Video processing failed, trying as static image...");
                sticker = new Sticker(buffer, {
                    ...stickerOptions,
                    background: 'transparent'
                });
            }
        }

        // Test sticker creation
        const stickerMessage = await sticker.toMessage();
        
        if (!stickerMessage || !stickerMessage.sticker) {
            throw new Error("Sticker message creation failed");
        }

        await bot.sendMessage(chatId, stickerMessage, { quoted: quotedMsg });
        console.log(`Sticker sent successfully: ${stickerTitle} (${format})`);
        return true;
        
    } catch (error) {
        console.error(`Error converting sticker "${stickerTitle}":`, error);
        
        // Final fallback - try basic sticker creation
        try {
            console.log(`Trying basic fallback for ${stickerTitle}...`);
            const basicSticker = new Sticker(fileData.buffer, {
                pack: "Telegram",
                author: "Import",
                type: StickerTypes.FULL,
                quality: 70
            });
            
            await bot.sendMessage(chatId, await basicSticker.toMessage(), { quoted: quotedMsg });
            console.log(`Basic fallback successful for ${stickerTitle}`);
            return true;
            
        } catch (fallbackError) {
            console.error(`All fallback methods failed for ${stickerTitle}:`, fallbackError);
            return false;
        }
    }
}

module.exports = {
  name: "sticker",
  alias: ["s"],
  description: "Ubah gambar/video/dokumen menjadi stiker, atau download sticker pack dari Telegram.",
  execute: async (msg, { bot, args }) => {
    const action = args[0];
    const telegramUrl = args[1];

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
        const firstSticker = packInfo.stickers[0];

        let thumbnailBuffer = null;
        
        try {
            if (firstSticker) {
                // Download thumbnail untuk preview
                const thumbnailData = await downloadTelegramFile(firstSticker, botToken);
                thumbnailBuffer = thumbnailData.buffer;
            }
        } catch (downloadError) {
            console.error("Gagal mendownload thumbnail:", downloadError);
        }

        // Simpan data ke session
        global.telegramStickerSessions[msg.sender] = {
          packInfo: packInfo,
          botToken: botToken,
          timestamp: Date.now()
        };

        const halfCount = Math.ceil(packInfo.totalCount / 2);
        const quarterCount = Math.ceil(packInfo.totalCount / 4);

        const buttonMessage = {
          caption: `📦 *Sticker Pack Ditemukan!*\n\n` +
                  `🎯 *Nama:* ${packInfo.title}\n` +
                  `🔗 *Pack ID:* ${packInfo.name}\n\n` +
                  `📊 *Detail:*\n` +
                  `🖼️ Sticker statis: ${packInfo.staticCount}\n` +
                  `🎬 Video sticker (WebM): ${packInfo.videoCount}\n` +
                  `🎭 Animated (TGS): ${packInfo.tgsCount}\n` +
                  `📈 Total sticker: ${packInfo.totalCount}\n\n` +
                  `❓ *Pilih opsi download:*\n` +
                  `⚠️ TGS animated belum didukung, hanya WebM dan statis.\n` +
                  `🎨 Semua sticker akan diproses dengan background transparan.`,
          footer: "Telegram Sticker Downloader - WebM Support",
          buttons: [
            {
              buttonId: `telegram_sticker_all`,
              buttonText: { displayText: `📦 Semua (${packInfo.totalCount})` },
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
          ],
          headerType: 4
        };

        // Tambahkan button untuk video sticker jika ada
        if (packInfo.videoCount > 0) {
          buttonMessage.buttons.push({
            buttonId: `telegram_sticker_video`,
            buttonText: { displayText: `🎬 Video WebM (${packInfo.videoCount})` },
            type: 1
          });
        }

        // Tambahkan button untuk static jika ada
        if (packInfo.staticCount > 0) {
          buttonMessage.buttons.push({
            buttonId: `telegram_sticker_static`,
            buttonText: { displayText: `🖼️ Statis (${packInfo.staticCount})` },
            type: 1
          });
        }

        // Warning untuk TGS
        if (packInfo.tgsCount > 0) {
          buttonMessage.caption += `\n\n⚠️ *Peringatan:* Pack ini mengandung ${packInfo.tgsCount} TGS animated sticker yang belum didukung.`;
        }

        if (thumbnailBuffer) {
            buttonMessage.image = thumbnailBuffer;
            buttonMessage.headerType = 4;
        }

        await bot.sendMessage(msg.from, buttonMessage, { quoted: msg });
        await msg.react("✅");

        // Set timeout untuk menghapus session setelah 5 menit
        setTimeout(() => {
          if (global.telegramStickerSessions && global.telegramStickerSessions[msg.sender]) {
            delete global.telegramStickerSessions[msg.sender];
          }
        }, 5 * 60 * 1000);

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

    // Original sticker creation logic untuk regular media
    let targetMsg = msg.quoted || msg;

    const validTypes = ['imageMessage', 'videoMessage', 'documentMessage'];
    if (!validTypes.includes(targetMsg.type)) {
        return msg.reply("❌ Kirim atau reply media yang valid dengan caption `.s`.\n\n" +
                        "💡 *Fitur Telegram Sticker Pack:*\n" +
                        "• `.s -get <URL>` - Download sticker pack dari Telegram\n" +
                        "• Contoh: `.s -get https://t.me/addstickers/packname`\n\n" +
                        "🎨 Support format: WebM (video transparan), WebP (statis), gambar biasa\n" +
                        "⚠️ TGS animated sticker belum didukung.");
    }

    let isVideo = targetMsg.type === 'videoMessage';
    if (targetMsg.type === 'documentMessage') {
        const mimetype = targetMsg.msg?.mimetype || '';
        if (mimetype.startsWith('video') || mimetype.includes('webm')) {
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
            console.log("Creating video sticker with transparency...");
            sticker = await createStickerFromVideo(buffer, stickerOptions);
        } else {
            console.log("Creating image sticker with transparency...");
            sticker = new Sticker(buffer, {
                ...stickerOptions,
                background: 'transparent'
            });
        }

        await bot.sendMessage(msg.from, await sticker.toMessage(), { quoted: msg });
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
      } else if (err.message.includes('TGS')) {
          errorMessage += "Format TGS animated sticker belum didukung.";
      } else {
          errorMessage += "Pastikan media valid dan coba lagi.";
      }
      
      return msg.reply(errorMessage);
    }
  },

  // Function untuk handle download dengan berbagai opsi - Updated untuk WebM
  downloadStickers: async function(bot, msg, option) {
    const sessionData = global.telegramStickerSessions[msg.sender];
    if (!sessionData) {
      return msg.reply("❌ Session expired. Silakan kirim ulang perintah download sticker pack.");
    }

    const { packInfo, botToken } = sessionData;
    let stickersToDownload = [];
    let optionText = "";

    // Tentukan sticker mana yang akan didownload berdasarkan opsi
    switch (option) {
      case 'all':
        stickersToDownload = packInfo.stickers;
        optionText = `semua ${packInfo.totalCount} sticker`;
        break;
      
      case 'half':
        const halfCount = Math.ceil(packInfo.totalCount / 2);
        stickersToDownload = packInfo.stickers.slice(0, halfCount);
        optionText = `${halfCount} sticker (setengah)`;
        break;
      
      case 'quarter':
        const quarterCount = Math.ceil(packInfo.totalCount / 4);
        stickersToDownload = packInfo.stickers.slice(0, quarterCount);
        optionText = `${quarterCount} sticker (seperempat)`;
        break;
      
      case 'video':
        stickersToDownload = packInfo.stickers.filter(s => s.is_video);
        optionText = `${stickersToDownload.length} video sticker (WebM)`;
        break;
      
      case 'animated':
        stickersToDownload = packInfo.stickers.filter(s => s.is_animated || s.is_video);
        optionText = `${stickersToDownload.length} animated sticker (WebM + TGS)`;
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

    // Hitung berapa TGS yang akan dilewati
    const tgsCount = stickersToDownload.filter(s => s.is_animated && !s.is_video).length;
    const processableCount = stickersToDownload.length - tgsCount;

    let statusMessage = `🚀 *Memulai download ${optionText}...*\n\n` +
                       `📦 Pack: ${packInfo.title}\n` +
                       `⏱️ Estimasi waktu: ${Math.ceil(processableCount * 3)} detik\n` +
                       `🎨 Background transparan: ✅\n` +
                       `🔄 Proses dimulai...\n`;

    if (tgsCount > 0) {
      statusMessage += `\n⚠️ *Peringatan:* ${tgsCount} TGS animated sticker akan dilewati (belum didukung)`;
    }

    await msg.reply(statusMessage);

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < stickersToDownload.length; i++) {
      const sticker = stickersToDownload[i];
      const stickerNum = i + 1;

      try {
        // Skip TGS animated stickers
        if (sticker.is_animated && !sticker.is_video) {
          console.log(`Skipping TGS sticker ${stickerNum}: not supported yet`);
          skippedCount++;
          continue;
        }

        // Update progress setiap 3 sticker
        if (stickerNum % 3 === 0 || stickerNum === 1) {
          const stickerType = sticker.is_video ? 'Video WebM' : 
                             sticker.is_animated ? 'TGS (Skip)' : 'Static WebP';
          
          await bot.sendMessage(msg.from, {
            text: `📊 Progress: ${stickerNum}/${stickersToDownload.length}\n` +
                  `✅ Berhasil: ${successCount} | ❌ Gagal: ${failedCount} | ⏭️ Skip: ${skippedCount}\n` +
                  `🎬 Sedang memproses: ${stickerType}`
          });
        }

        console.log(`Processing sticker ${stickerNum}/${stickersToDownload.length}: video=${sticker.is_video}, animated=${sticker.is_animated}`);

        // Download sticker dari Telegram
        let fileData;
        try {
          fileData = await downloadTelegramFile(sticker, botToken);
        } catch (downloadError) {
          console.error(`Download failed for sticker ${stickerNum}:`, downloadError);
          failedCount++;
          continue;
        }

        // Validasi file data
        if (!fileData || !fileData.buffer || fileData.buffer.length === 0) {
          console.error(`Empty file data for sticker ${stickerNum}`);
          failedCount++;
          continue;
        }

        // Skip file yang terlalu besar
        if (fileData.size > 8 * 1024 * 1024) { // 8MB
          console.log(`Skipping oversized sticker ${stickerNum}: ${fileData.size} bytes`);
          skippedCount++;
          continue;
        }

        // Konversi dan kirim sticker
        const success = await convertAndSendSticker(
          bot,
          msg.from,
          fileData,
          `${packInfo.title} - Sticker ${stickerNum} (${fileData.format})`,
          msg
        );

        if (success) {
          successCount++;
        } else {
          failedCount++;
        }

        // Delay untuk anti-spam (3 detik untuk video, 2 detik untuk static)
        if (i < stickersToDownload.length - 1) {
          const delay = sticker.is_video ? 3000 : 2000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }

      } catch (error) {
        console.error(`Unexpected error processing sticker ${stickerNum}:`, error);
        failedCount++;

        // Stop jika error rate terlalu tinggi
        if (failedCount > Math.ceil(stickersToDownload.length * 0.6)) {
          await msg.reply(`⚠️ Terlalu banyak error (>60%). Menghentikan proses.\n\n` +
                         `✅ Berhasil: ${successCount}\n` +
                         `❌ Gagal: ${failedCount}\n` +
                         `⏭️ Dilewati: ${skippedCount}`);
          break;
        }
      }
    }

    // Summary report
    const totalProcessed = successCount + failedCount;
    const successRate = totalProcessed > 0 ? Math.round((successCount / totalProcessed) * 100) : 0;
    
    await msg.reply(`🎉 *Download selesai!*\n\n` +
                   `📦 Pack: ${packInfo.title}\n` +
                   `🎯 Opsi: ${optionText}\n` +
                   `✅ Berhasil: ${successCount}\n` +
                   `❌ Gagal: ${failedCount}\n` +
                   `⏭️ Dilewati: ${skippedCount} (TGS + oversized)\n` +
                   `📊 Total diproses: ${stickersToDownload.length}\n` +
                   `📈 Success rate: ${successRate}%\n\n` +
                   `🎨 Format didukung: WebM (video transparan), WebP (statis)\n` +
                   `⚠️ TGS animated belum didukung\n` +
                   `🙏 Terima kasih telah menggunakan layanan download!`);

    // Clear session
    if (global.telegramStickerSessions[msg.sender]) {
      delete global.telegramStickerSessions[msg.sender];
    }
  },

  // Fungsi lama untuk backward compatibility
  downloadAllStickers: async function(bot, msg) {
    return this.downloadStickers(bot, msg, 'all');
  }
};
