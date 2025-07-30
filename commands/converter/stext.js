const sharp = require('sharp');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');

// Fungsi untuk menyusun teks sesuai aturan baru
function formatText(text) {
    const words = text.trim().split(/\s+/);
    const total = words.length;

    if (total <= 3) return words; // susun vertikal satu per baris

    const lines = [];
    let i = 0;

    const isOdd = total % 2 === 1 || total % 3 === 1;
    const lastWordAlone = isOdd && total >= 5;

    const limit = lastWordAlone ? total - 1 : total;

    while (i < limit) {
        const remaining = limit - i;
        const take = remaining >= 3 ? 3 : 2;
        lines.push(words.slice(i, i + take).join(' '));
        i += take;
    }

    if (lastWordAlone) {
        lines.push(words[words.length - 1]); // kata terakhir di baris sendiri
    }

    return lines;
}

// Escape karakter HTML
function escapeHtml(text) {
    return text.replace(/&/g, '&amp;')
               .replace(/</g, '&lt;')
               .replace(/>/g, '&gt;')
               .replace(/"/g, '&quot;')
               .replace(/'/g, '&#39;');
}

// Fungsi render teks menjadi gambar kotak + padding
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
                padding: 0;
                font-family: "Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji", sans-serif;
            }
            .container {
                display: inline-block;
                padding: 40px;
                text-align: justify;
                font-size: ${fontSize}px;
                line-height: ${lineHeight}px;
                color: #333;
                word-wrap: break-word;
                text-justify: inter-word;
                max-width: 800px;
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
                text-align: left !important;
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
    const element = await page.$('#capture');
    const bbox = await element.boundingBox();

    const screenshot = await page.screenshot({
        type: 'png',
        omitBackground: false,
        clip: {
            x: Math.floor(bbox.x),
            y: Math.floor(bbox.y),
            width: Math.ceil(bbox.width),
            height: Math.ceil(bbox.height),
        }
    });

    await browser.close();

    const size = Math.max(bbox.width, bbox.height);
    const padX = Math.floor((size - bbox.width) / 2);
    const padY = Math.floor((size - bbox.height) / 2);

    const paddedImage = await sharp({
        create: {
            width: Math.ceil(size),
            height: Math.ceil(size),
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
    })
    .composite([{ input: screenshot, left: padX, top: padY }])
    .png()
    .toBuffer();

    return paddedImage;
}

// Deteksi apakah mengandung emoji
function hasEmoji(text) {
    const emojiRegex = /[\u{1f300}-\u{1f5ff}\u{1f900}-\u{1f9ff}\u{1f600}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}\u{1f1e6}-\u{1f1ff}\u{1f191}-\u{1f251}\u{1f004}\u{1f0cf}\u{1f170}-\u{1f171}\u{1f17e}-\u{1f17f}\u{1f18e}\u{3030}\u{2b50}\u{2b55}\u{2934}-\u{2935}\u{2b05}-\u{2b07}\u{2b1b}-\u{2b1c}\u{3297}\u{3299}\u{303d}\u{00a9}\u{00ae}\u{2122}\u{23f3}\u{24c2}\u{23e9}-\u{23ef}\u{25b6}\u{23f8}-\u{23fa}]/gu;
    return emojiRegex.test(text);
}

module.exports = {
    name: "stext",
    alias: ["stickertext", "stikerteks", "stextsquare"],
    description: "Membuat stiker teks kotak dengan emoji warna dan logika baris pintar.",
    category: "converter",
    execute: async (msg, { bot, args, usedPrefix, command }) => {
        const text = args.join(' ').trim();
        if (!text) {
            return msg.reply(`Gunakan: *${usedPrefix + command} <teks>*\nContoh: ${usedPrefix + command} makan dulu ah 🍜`);
        }

        if (text.length > 120) {
            return msg.reply('❌ Teks terlalu panjang! Maksimal 120 karakter.');
        }

        try {
            await msg.react("🎨");
            console.log(`🖼️ Membuat stiker dari teks: "${text}"`);

            let imageBuffer;
            try {
                imageBuffer = await generateImageWithPuppeteer(text);
            } catch (err) {
                console.error("❌ Puppeteer error:", err);
                return msg.reply("⚠️ Gagal membuat stiker. Pastikan puppeteer & Chromium terinstal.");
            }

            const sticker = new Sticker(imageBuffer, {
                pack: process.env.stickerPackname || 'Smart Text',
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
