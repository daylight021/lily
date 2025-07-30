const sharp = require('sharp');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');

// Fungsi untuk memformat teks menjadi 2–3 kata per baris
function formatText(text) {
    const words = text.trim().split(/\s+/);
    const lines = [];
    let i = 0;
    while (i < words.length) {
        const remaining = words.length - i;
        if (remaining === 1) {
            lines.push(words[i]);
            break;
        } else if (remaining === 2) {
            lines.push(words.slice(i, i + 2).join(' '));
            break;
        } else {
            lines.push(words.slice(i, i + 3).join(' '));
            i += 3;
        }
    }
    return lines;
}

// Escape HTML entities
function escapeHtml(text) {
    return text.replace(/&/g, '&amp;')
               .replace(/</g, '&lt;')
               .replace(/>/g, '&gt;')
               .replace(/"/g, '&quot;')
               .replace(/'/g, '&#39;');
}

// Puppeteer untuk emoji dan teks justify
async function generateImageWithPuppeteer(text) {
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();

    const lines = formatText(text);
    const lineCount = lines.length;
    const fontSize = lineCount > 6 ? 28 : lineCount > 4 ? 36 : 44;
    const lineHeight = fontSize * 1.5;

    const html = `
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body {
                margin: 0;
                width: 512px;
                height: 512px;
                background: white;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .container {
                width: 80%;
                text-align: justify;
                font-family: "Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji", sans-serif;
                font-size: ${fontSize}px;
                line-height: ${lineHeight}px;
                color: #333;
            }
            .container::after {
                content: '';
                display: inline-block;
                width: 100%;
            }
        </style>
    </head>
    <body>
        <div class="container">
            ${lines.map(line => escapeHtml(line)).join('<br>')}
        </div>
    </body>
    </html>`;

    await page.setContent(html);
    const buffer = await page.screenshot({
        type: 'png',
        omitBackground: false,
        clip: { x: 0, y: 0, width: 512, height: 512 }
    });
    await browser.close();
    return buffer;
}

// Deteksi emoji
function hasEmoji(text) {
    const emojiRegex = /[\u{1f300}-\u{1f5ff}\u{1f900}-\u{1f9ff}\u{1f600}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}\u{1f1e6}-\u{1f1ff}\u{1f191}-\u{1f251}\u{1f004}\u{1f0cf}\u{1f170}-\u{1f171}\u{1f17e}-\u{1f17f}\u{1f18e}\u{3030}\u{2b50}\u{2b55}\u{2934}-\u{2935}\u{2b05}-\u{2b07}\u{2b1b}-\u{2b1c}\u{3297}\u{3299}\u{303d}\u{00a9}\u{00ae}\u{2122}\u{23f3}\u{24c2}\u{23e9}-\u{23ef}\u{25b6}\u{23f8}-\u{23fa}]/gu;
    return emojiRegex.test(text);
}

module.exports = {
    name: "stext",
    alias: ["stickertext", "stikerteks", "stextsquare"],
    description: "Membuat stiker teks kotak dengan emoji warna & justify.",
    category: "converter",
    execute: async (msg, { bot, args, usedPrefix, command }) => {
        const text = args.join(' ').trim();
        if (!text) {
            return msg.reply(`Kirim perintah dengan format:\n*${usedPrefix + command} <teks kamu>*\n\nContoh: ${usedPrefix + command} Bentar ma'em dlu 😋`);
        }

        if (text.length > 100) {
            return msg.reply('❌ Teks terlalu panjang! Maksimal 100 karakter.');
        }

        try {
            await msg.react("🎨");
            console.log(`🎭 Membuat stiker dari teks: "${text}"`);

            let imageBuffer;
            try {
                imageBuffer = await generateImageWithPuppeteer(text);
            } catch (error) {
                console.error("❌ Puppeteer gagal:", error);
                return msg.reply("⚠️ Gagal membuat stiker (puppeteer error). Pastikan puppeteer terinstall dan Chromium bisa dijalankan.");
            }

            const sticker = new Sticker(imageBuffer, {
                pack: process.env.stickerPackname || 'Emoji Text Pack',
                author: process.env.stickerAuthor || 'Bot',
                type: StickerTypes.FULL,
                quality: 90,
            });

            const stickerBuffer = await sticker.toMessage();
            await bot.sendMessage(msg.from, stickerBuffer, { quoted: msg });
            await msg.react("✅");
        } catch (error) {
            console.error("❌ Gagal membuat stiker:", error);
            await msg.react("❌");
            msg.reply(`❌ Terjadi kesalahan:\n${error.message}`);
        }
    }
};
