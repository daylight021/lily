const sharp = require('sharp');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');

// Fungsi untuk membagi teks jadi 2–3 kata per baris
function formatText(text) {
    const words = text.trim().split(/\s+/);
    const lines = [];
    let currentLine = [];

    for (let i = 0; i < words.length; i++) {
        currentLine.push(words[i]);
        const isLastWord = i === words.length - 1;
        const isNextLine = currentLine.length >= 3 || (currentLine.length === 2 && isLastWord);

        if (isNextLine || isLastWord) {
            lines.push(currentLine.join(' '));
            currentLine = [];
        }
    }
    return lines;
}

// Escape HTML entity untuk teks
function escapeHtml(text) {
    return text.replace(/&/g, '&amp;')
               .replace(/</g, '&lt;')
               .replace(/>/g, '&gt;')
               .replace(/"/g, '&quot;')
               .replace(/'/g, '&#39;');
}

// Fungsi utama untuk render dengan Puppeteer (ukuran dinamis)
async function generateImageWithPuppeteer(text) {
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();

    const lines = formatText(text);
    const lineCount = lines.length;
    const fontSize = lineCount > 6 ? 28 : lineCount > 4 ? 36 : 44;
    const lineHeight = fontSize * 1.6;

    const html = `
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            html, body {
                margin: 0;
                background: white;
                padding: 20px;
                font-family: "Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji", sans-serif;
            }
            .container {
                display: inline-block;
                min-width: 512px;
                max-width: 768px;
                text-align: justify;
                font-size: ${fontSize}px;
                line-height: ${lineHeight}px;
                color: #333;
                word-wrap: break-word;
                text-justify: inter-word;
            }
            .container::after {
                content: '';
                display: inline-block;
                width: 100%;
            }
            .line {
                display: block;
                text-align: justify;
                text-justify: inter-word;
                word-wrap: break-word;
            }
            .line:last-child {
                text-align: left;
            }
        </style>
    </head>
    <body>
        <div class="container" id="capture">
            ${lines.map(line => `<span class="line">${escapeHtml(line)}</span>`).join('\n')}
        </div>
    </body>
    </html>`;

    await page.setContent(html);

    const captureElement = await page.$('#capture');
    const boundingBox = await captureElement.boundingBox();

    const buffer = await page.screenshot({
        type: 'png',
        omitBackground: false,
        clip: {
            x: Math.floor(boundingBox.x),
            y: Math.floor(boundingBox.y),
            width: Math.ceil(boundingBox.width),
            height: Math.ceil(boundingBox.height)
        }
    });

    await browser.close();
    return buffer;
}

// Deteksi apakah teks mengandung emoji
function hasEmoji(text) {
    const emojiRegex = /[\u{1f300}-\u{1f5ff}\u{1f900}-\u{1f9ff}\u{1f600}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}\u{1f1e6}-\u{1f1ff}\u{1f191}-\u{1f251}\u{1f004}\u{1f0cf}\u{1f170}-\u{1f171}\u{1f17e}-\u{1f17f}\u{1f18e}\u{3030}\u{2b50}\u{2b55}\u{2934}-\u{2935}\u{2b05}-\u{2b07}\u{2b1b}-\u{2b1c}\u{3297}\u{3299}\u{303d}\u{00a9}\u{00ae}\u{2122}\u{23f3}\u{24c2}\u{23e9}-\u{23ef}\u{25b6}\u{23f8}-\u{23fa}]/gu;
    return emojiRegex.test(text);
}

module.exports = {
    name: "stext",
    alias: ["stickertext", "stikerteks", "stextsquare"],
    description: "Membuat stiker teks dinamis dengan emoji berwarna & rata kiri-kanan.",
    category: "converter",
    execute: async (msg, { bot, args, usedPrefix, command }) => {
        const text = args.join(' ').trim();
        if (!text) {
            return msg.reply(`Gunakan:\n*${usedPrefix + command} <teks>*\nContoh: ${usedPrefix + command} aku laper banget 😩`);
        }

        if (text.length > 120) {
            return msg.reply('❌ Teks terlalu panjang! Maksimal 120 karakter.');
        }

        try {
            await msg.react("🎨");
            console.log(`🖼️ Membuat stiker dari: "${text}"`);

            let imageBuffer;
            try {
                imageBuffer = await generateImageWithPuppeteer(text);
            } catch (err) {
                console.error("❌ Puppeteer error:", err);
                return msg.reply("⚠️ Gagal membuat stiker. Pastikan Puppeteer & Chromium terinstal dengan benar.");
            }

            const sticker = new Sticker(imageBuffer, {
                pack: process.env.stickerPackname || 'Dynamic Text',
                author: process.env.stickerAuthor || 'Bot',
                type: StickerTypes.FULL,
                quality: 90,
            });

            const stickerBuffer = await sticker.toMessage();
            await bot.sendMessage(msg.from, stickerBuffer, { quoted: msg });
            await msg.react("✅");
        } catch (error) {
            console.error("❌ Error:", error);
            await msg.react("❌");
            msg.reply(`❌ Terjadi kesalahan:\n${error.message}`);
        }
    }
};
