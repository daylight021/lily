const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
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

async function generateImageWithPuppeteer(text, fontName, transparent = false) {
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();

    const lines = formatText(text);
    const lineCount = lines.length;
    const fontSize = lineCount > 6 ? 28 : lineCount > 4 ? 36 : 44;
    const lineHeight = fontSize * 1.6;

    const fonts = listAvailableFonts();
    const matchedFont = fonts.find(f => f.name === fontName?.toLowerCase());
    let fontFaceCSS = '';
    let fontFamily = 'DefaultEmojiFont';

    if (matchedFont) {
        const fontBuffer = fs.readFileSync(path.join(fontsDir, matchedFont.file));
        const fontBase64 = fontBuffer.toString('base64');
        const ext = matchedFont.file.endsWith('.otf') ? 'opentype' : 'truetype';
        fontFamily = 'CustomFont';

        fontFaceCSS = `
        @font-face {
            font-family: '${fontFamily}';
            src: url(data:font/${ext};charset=utf-8;base64,${fontBase64}) format('${ext}');
            font-weight: normal;
            font-style: normal;
        }`;
    }

    const html = `
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            ${fontFaceCSS}
            html, body {
                margin: 0;
                background: ${transparent ? 'transparent' : 'white'};
                padding: 0;
                font-family: '${fontFamily}', "Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji", sans-serif;
            }
            .container {
                display: inline-block;
                padding: 40px;
                text-align: justify;
                font-size: ${fontSize}px;
                line-height: ${lineHeight}px;
                color: ${transparent ? '#fff' : '#333'};
                -webkit-text-stroke: ${transparent ? '1px black' : 'none'};
                text-shadow: ${transparent ? '0 0 2px black' : 'none'};
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
        omitBackground: transparent,
        clip: {
            x: Math.floor(bbox.x),
            y: Math.floor(bbox.y),
            width: Math.ceil(bbox.width),
            height: Math.ceil(bbox.height)
        }
    });

    await browser.close();

    const size = Math.max(bbox.width, bbox.height);
    const padX = Math.floor((size - bbox.width) / 2);
    const padY = Math.floor((size - bbox.height) / 2);

    return await sharp({
        create: {
            width: Math.ceil(size),
            height: Math.ceil(size),
            channels: 4,
            background: transparent ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: 255, g: 255, b: 255, alpha: 1 }
        }
    }).composite([{ input: screenshot, left: padX, top: padY }]).png().toBuffer();
}

module.exports = {
    name: "stext",
    alias: ["stickertext", "stikerteks"],
    description: "Buat stiker teks kotak dengan emoji warna, background transparan, dan font kustom.",
    category: "converter",
    execute: async (msg, { bot, args, usedPrefix, command }) => {
        const input = args.join(' ').trim();
        if (!input) {
            return msg.reply(`Gunakan:\n*${usedPrefix + command} [-t] [-nama_font] <teks>*\n\nContoh:\n${usedPrefix + command} -t -raleway-heavy makan dulu 😋`);
        }

        if (input === '-font') {
            const fonts = listAvailableFonts();
            if (fonts.length === 0) return msg.reply('❌ Tidak ada font ditemukan di folder assets/fonts.');
            let reply = '*📚 Font Tersedia:*\n\n';
            fonts.forEach(f => {
                reply += `- *${f.name}*: Gunakan dengan \`-${f.name}\`\n`;
            });
            return msg.reply(reply);
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
