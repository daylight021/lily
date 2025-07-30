const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const puppeteer = require('puppeteer');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const fontsDir = path.join(__dirname, '../../lib/fonts');

function listAvailableFonts() {
    if (!fs.existsSync(fontsDir)) return [];
    return fs.readdirSync(fontsDir)
        .filter(file => /\.(ttf|otf)$/i.test(file))
        .map(file => {
            const name = path.parse(file).name.toLowerCase();
            return { name, file };
        });
}

function formatText(text) {
    const words = text.trim().split(/\s+/);
    const total = words.length;
    if (total <= 3) return words;
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
    if (lastWordAlone) lines.push(words[words.length - 1]);
    return lines;
}

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;')
               .replace(/</g, '&lt;')
               .replace(/>/g, '&gt;')
               .replace(/"/g, '&quot;')
               .replace(/'/g, '&#39;');
}

async function generateFontPreviewImagePuppeteer() {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const fonts = listAvailableFonts();

    let fontStyles = '';
    let htmlBody = '';

    for (const font of fonts) {
        const fontPath = path.join(fontsDir, font.file);
        const fontBuffer = fs.readFileSync(fontPath);
        const fontBase64 = fontBuffer.toString('base64');
        const ext = font.file.endsWith('.otf') ? 'opentype' : 'truetype';
        const fontId = `font_${font.name.replace(/[^a-z0-9]/gi, '_')}`;

        fontStyles += `
        @font-face {
            font-family: '${fontId}';
            src: url(data:font/${ext};charset=utf-8;base64,${fontBase64}) format('${ext}');
        }`;

        htmlBody += `
        <div class="item">
            <div class="label">Nama Font: ${font.name}</div>
            <div class="preview" style="font-family: '${fontId}'">Preview: ${font.name} ABC abc 123 😁✨</div>
        </div>`;
    }

    const html = `
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            ${fontStyles}
            body {
                background: white;
                margin: 0;
                font-family: sans-serif;
                padding: 30px;
            }
            .item {
                margin-bottom: 40px;
            }
            .label {
                font-size: 20px;
                color: #444;
                margin-bottom: 8px;
            }
            .preview {
                font-size: 36px;
                line-height: 1.4;
                color: #000;
            }
        </style>
    </head>
    <body>
        ${htmlBody}
    </body>
    </html>`;

    await page.setContent(html);
    const clip = await page.evaluate(() => {
        const body = document.body;
        const { width, height } = body.getBoundingClientRect();
        return { x: 0, y: 0, width: Math.ceil(width), height: Math.ceil(height) };
    });

    const buffer = await page.screenshot({ clip, omitBackground: false });
    await browser.close();
    return buffer;
}

module.exports = {
    name: "stext",
    alias: ["stickertext", "stikerteks"],
    description: "Buat stiker teks atau lihat daftar font",
    category: "converter",
    execute: async (msg, { bot, args, usedPrefix, command }) => {
        const input = args.join(' ').trim();

        if (!input) {
            return msg.reply(`Gunakan:\n*${usedPrefix + command} [-t] [-nama_font] <teks>*\n\nContoh:\n${usedPrefix + command} -t -raleway-bold makan dulu 😋`);
        }

        if (input === '-font') {
            const fonts = listAvailableFonts();
            if (fonts.length === 0) return msg.reply('❌ Tidak ada font ditemukan di folder assets/fonts.');
            await msg.reply('📸 Menghasilkan preview semua font...');
            const buffer = await generateFontPreviewImagePuppeteer();
            return bot.sendMessage(msg.from, {
                image: buffer,
                caption: `📚 *Preview Font Tersedia*\n\nGunakan: *.stext -nama_font teks*\nContoh: *.stext -raleway-bold halo dunia*`
            }, { quoted: msg });
        }

        const flags = [];
        const words = input.trim().split(/\s+/);
        const contentWords = [];

        for (const word of words) {
            if (/^-/.test(word) && word.length > 1) {
                flags.push(word.slice(1).toLowerCase());
            } else {
                contentWords.push(word);
            }
        }

        const text = contentWords.join(' ').trim();
        if (!text) return msg.reply('❌ Teks tidak ditemukan setelah parameter.');

        const isTransparent = flags.includes('t');
        const fonts = listAvailableFonts();
        const fontFlag = flags.find(f => f !== 't' && fonts.some(ff => ff.name === f));
        const fontToUse = fontFlag || null;

        try {
            await msg.react("🎨");

            const imageBuffer = await generateImageWithPuppeteer(text, fontToUse, isTransparent);

            const sticker = new Sticker(imageBuffer, {
                pack: process.env.stickerPackname || 'Text Sticker',
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
            msg.reply(`❌ Gagal membuat stiker:\n${error.message}`);
        }
    }
};