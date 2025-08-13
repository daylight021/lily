const { Sticker, StickerTypes } = require("wa-sticker-formatter");
const { downloadMediaMessage } = require("lily-baileys");
const { createStickerFromVideo, createStickerFromTGS } = require("../../lib/sticker.js");
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const https = require('https');

const httpsAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 60000
});

const TEMP_DIR = path.join(__dirname, '../../temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

global.telegramStickerSessions = global.telegramStickerSessions || {};

function extractStickerPackName(url) {
    const match = url.match(/(?:https?:\/\/)?(?:www\.)?t\.me\/addstickers\/(.+)/);
    return match ? match[1] : null;
}

async function downloadTelegramFile(sticker, botToken) {
    const fileId = sticker.file_id;
    const fileInfoResponse = await axios.get(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`, { httpsAgent });
    if (!fileInfoResponse.data.ok) throw new Error(fileInfoResponse.data.description);

    const fileInfo = fileInfoResponse.data.result;
    const filePath = fileInfo.file_path;
    const format = filePath.endsWith('.tgs') ? 'tgs'
                 : filePath.endsWith('.webm') ? 'webm'
                 : filePath.endsWith('.webp') ? 'webp'
                 : filePath.endsWith('.mp4') ? 'mp4'
                 : 'unknown';

    const downloadResponse = await axios.get(`https://api.telegram.org/file/bot${botToken}/${filePath}`, {
        responseType: 'arraybuffer',
        httpsAgent
    });

    return {
        buffer: Buffer.from(downloadResponse.data),
        format,
        isAnimated: sticker.is_animated || sticker.is_video,
        isWebm: sticker.is_video
    };
}

async function getTelegramStickerPack(packName, botToken) {
    const response = await axios.get(`https://api.telegram.org/bot${botToken}/getStickerSet?name=${packName}`);
    if (!response.data.ok) throw new Error(response.data.description);
    const stickerSet = response.data.result;
    let staticCount = 0, videoCount = 0, tgsCount = 0;
    stickerSet.stickers.forEach(st => {
        if (st.is_video) videoCount++;
        else if (st.is_animated) tgsCount++;
        else staticCount++;
    });
    return {
        title: stickerSet.title,
        name: stickerSet.name,
        stickers: stickerSet.stickers,
        staticCount,
        videoCount,
        tgsCount,
        totalCount: stickerSet.stickers.length
    };
}

async function convertAndSendSticker(bot, chatId, fileData, stickerTitle, quotedMsg) {
    const { buffer, format, isWebm } = fileData;
    if (!buffer || buffer.length === 0) throw new Error("Buffer kosong");

    const stickerOptions = {
        pack: process.env.stickerPackname || "Telegram Stiker",
        author: process.env.stickerAuthor || "Dari Telegram",
        type: StickerTypes.FULL,
        quality: 90,
        background: 'transparent'
    };

    let sticker;
    if (format === 'tgs') {
        console.log(`Converting TGS: ${stickerTitle}`);
        sticker = await createStickerFromTGS(buffer, stickerOptions);
    } else if (isWebm) {
        console.log(`Converting WebM: ${stickerTitle}`);
        sticker = await createStickerFromVideo(buffer, stickerOptions);
    } else {
        sticker = new Sticker(buffer, { ...stickerOptions, background: 'transparent' });
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

        // Handle tombol pilihan
        if (msg.isGroup && msg.body && msg.body.startsWith('telegram_sticker_')) {
            const option = msg.body.replace('telegram_sticker_', '');
            return module.exports.downloadStickers(bot, msg, option);
        }

        // Handle download pack dari Telegram
        if (action === '-get' && telegramUrl) {
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            if (!botToken) return msg.reply("❌ Telegram Bot Token tidak ditemukan.");
            const packName = extractStickerPackName(telegramUrl);
            if (!packName) return msg.reply("❌ URL tidak valid.");

            await msg.react("⏳");

            try {
                const packInfo = await getTelegramStickerPack(packName, botToken);

                global.telegramStickerSessions[sender] = { packInfo, botToken, timestamp: Date.now() };

                const buttons = [
                    { buttonId: `telegram_sticker_all`, buttonText: { displayText: `📦 Semua (${packInfo.totalCount})` }, type: 1 },
                    { buttonId: `telegram_sticker_half`, buttonText: { displayText: `📦 ${Math.ceil(packInfo.totalCount/2)} Sticker` }, type: 1 },
                    { buttonId: `telegram_sticker_quarter`, buttonText: { displayText: `📦 ${Math.ceil(packInfo.totalCount/4)} Sticker` }, type: 1 }
                ];
                if (packInfo.videoCount > 0) buttons.push({ buttonId: `telegram_sticker_video`, buttonText: { displayText: `🎬 Video WebM (${packInfo.videoCount})` }, type: 1 });
                if (packInfo.tgsCount > 0) buttons.push({ buttonId: `telegram_sticker_tgs`, buttonText: { displayText: `🎭 TGS Animasi (${packInfo.tgsCount})` }, type: 1 });
                if (packInfo.staticCount > 0) buttons.push({ buttonId: `telegram_sticker_static`, buttonText: { displayText: `🖼️ Statis (${packInfo.staticCount})` }, type: 1 });

                // ambil thumbnail dari sticker pack atau salah satu stiker statis
                let thumbBuffer;
                if (packInfo.thumb && packInfo.thumb.file_id) {
                    const thumbData = await downloadTelegramFile(packInfo.thumb, botToken);
                    thumbBuffer = thumbData.buffer;
                } else {
                    const staticSticker = packInfo.stickers.find(s => !s.is_animated && !s.is_video);
                    if (staticSticker) {
                        const staticData = await downloadTelegramFile(staticSticker, botToken);
                        thumbBuffer = staticData.buffer;
                    }
                }

                await bot.sendMessage(from, {
                    image: thumbBuffer,
                    caption: `📦 *Sticker Pack Ditemukan!* ...`,
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

        // Konversi media biasa
        const targetMsg = msg.quoted || msg;
        const validTypes = ['imageMessage', 'videoMessage', 'documentMessage'];
        if (!validTypes.includes(targetMsg.type)) {
            return msg.reply("❌ Kirim atau reply media yang valid dengan caption `.s`.");
        }

        let isVideo = targetMsg.type === 'videoMessage';
        if (targetMsg.type === 'documentMessage') {
            const mimetype = targetMsg.msg?.mimetype || '';
            if (mimetype.includes('webm') || mimetype.includes('tgs')) {
                isVideo = true;
            } else if (!mimetype.startsWith('image')) {
                return msg.reply("❌ Dokumen bukan gambar atau video.");
            }
        }

        await msg.react("⏳");
        try {
            const buffer = await downloadMediaMessage(
                targetMsg.isViewOnce ? targetMsg.raw : targetMsg,
                "buffer",
                {},
                { reuploadRequest: bot.updateMediaMessage }
            );

            if (!buffer || buffer.length === 0) throw new Error("Media kosong");

            const stickerOptions = {
                pack: process.env.stickerPackname || "Bot Stiker",
                author: process.env.stickerAuthor || "Dibuat oleh Bot",
                type: StickerTypes.FULL,
                quality: 90,
                background: 'transparent'
            };

            let sticker;
            if (isVideo) {
                sticker = await createStickerFromVideo(buffer, stickerOptions);
            } else {
                sticker = new Sticker(buffer, { ...stickerOptions, background: 'transparent' });
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
        let stickersToDownload = [];
        switch (option) {
            case 'all': stickersToDownload = packInfo.stickers; break;
            case 'half': stickersToDownload = packInfo.stickers.slice(0, Math.ceil(packInfo.totalCount/2)); break;
            case 'quarter': stickersToDownload = packInfo.stickers.slice(0, Math.ceil(packInfo.totalCount/4)); break;
            case 'video': stickersToDownload = packInfo.stickers.filter(s => s.is_video); break;
            case 'tgs': stickersToDownload = packInfo.stickers.filter(s => s.is_animated && !s.is_video); break;
            case 'static': stickersToDownload = packInfo.stickers.filter(s => !s.is_animated && !s.is_video); break;
            default: return msg.reply("❌ Opsi tidak valid.");
        }

        for (let i = 0; i < stickersToDownload.length; i++) {
            const sticker = stickersToDownload[i];
            try {
                const fileData = await downloadTelegramFile(sticker, botToken);
                await convertAndSendSticker(bot, msg.from, fileData, `${packInfo.title} - ${i+1}`, msg);
                await new Promise(r => setTimeout(r, sticker.is_video || fileData.format === 'tgs' ? 5000 : 2000));
            } catch (err) {
                console.error(`Error sticker ${i+1}:`, err.message);
            }
        }

        delete global.telegramStickerSessions[msg.sender];
    }
};
