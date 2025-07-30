const sharp = require('sharp');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');

// Fungsi untuk memformat teks
function formatText(text) {
    const words = text.split(' ');
    if (words.length > 0 && words.length <= 3) return words;
    const lines = [];
    let currentLine = [];
    for (let i = 0; i < words.length; i++) {
        currentLine.push(words[i]);
        const wordsPerLine = (words.length - i > 3) ? 3 : 2;
        if (currentLine.length >= wordsPerLine || i === words.length - 1) {
            lines.push(currentLine.join(' '));
            currentLine = [];
        }
    }
    return lines;
}

// Escape HTML entities
function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Formatting bold/italic/strike
function processFormatting(text) {
    return text
        .replace(/\*([^*]+)\*/g, '<tspan font-weight="bold">$1</tspan>')
        .replace(/_([^_]+)_/g, '<tspan font-style="italic">$1</tspan>')
        .replace(/~([^~]+)~/g, '<tspan text-decoration="line-through">$1</tspan>');
}

// SVG fallback generator
function generateColorEmojiSVG(text) {
    const lines = formatText(text);
    const fontSize = lines.length > 2 ? 48 : lines.length > 1 ? 56 : 64;
    const lineHeight = fontSize * 1.2;
    const totalHeight = lines.length * lineHeight;
    const startY = (512 - totalHeight) / 2 + fontSize * 0.8;
    const fontFamily = '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", "Twitter Color Emoji", "EmojiOne Color", Arial, sans-serif';

    const textElements = lines.map((line, index) => {
        const y = startY + (index * lineHeight);
        const processedLine = processFormatting(escapeHtml(line));
        return `<text x="256" y="${y}" text-anchor="middle" font-family="${fontFamily}" font-size="${fontSize}" fill="#333333" dominant-baseline="middle">${processedLine}</text>`;
    }).join('');

    return `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
        <rect width="512" height="512" fill="#ffffff"/>
        ${textElements}
    </svg>`;
}

// Canvas method
async function generateCanvasImage(text) {
    const { createCanvas, registerFont } = require('canvas');
    try { registerFont('/usr/share/fonts/truetype/NotoColorEmoji.ttf', { family: 'Noto Color Emoji' }); } catch {}
    const lines = formatText(text);
    const fontSize = lines.length > 2 ? 48 : lines.length > 1 ? 56 : 64;
    const lineHeight = fontSize * 1.2;
    const canvas = createCanvas(512, 512);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = '#333';
    ctx.font = `${fontSize}px "Noto Color Emoji", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const totalHeight = lines.length * lineHeight;
    const startY = (512 - totalHeight) / 2 + lineHeight / 2;
    lines.forEach((line, index) => {
        const y = startY + (index * lineHeight);
        ctx.fillText(line, 256, y);
    });
    return canvas.toBuffer('image/png');
}

// Sharp enhanced SVG method
async function generateSharpImage(text) {
    const lines = formatText(text);
    const fontSize = lines.length > 2 ? 48 : lines.length > 1 ? 56 : 64;
    const lineHeight = fontSize * 1.2;
    let image = sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } });
    const totalHeight = lines.length * lineHeight;
    const startY = (512 - totalHeight) / 2;
    const textOverlays = lines.map((line, i) => {
        const y = startY + (i * lineHeight);
        const lineSvg = `<svg width="512" height="100" xmlns="http://www.w3.org/2000/svg">
            <style>
                .emoji-text { font-family: "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", Arial, sans-serif; font-size: ${fontSize}px; fill: #333; text-anchor: middle; dominant-baseline: middle; }
            </style>
            <text x="256" y="50" class="emoji-text">${escapeHtml(line)}</text>
        </svg>`;
        return { input: Buffer.from(lineSvg), top: Math.round(y - fontSize * 0.4), left: 0 };
    });
    if (textOverlays.length > 0) image = image.composite(textOverlays);
    return await image.png().toBuffer();
}

// Puppeteer method (rekomendasi utama)
async function generateImageWithPuppeteer(text) {
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const html = `<html><head><meta charset="utf-8">
        <style>
        body { margin:0; background:#fff; width:512px; height:512px; display:flex; align-items:center; justify-content:center; font-size:64px; color:#333; font-family:"Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji", sans-serif; text-align:center; }
        </style></head><body>${escapeHtml(text)}</body></html>`;
    await page.setContent(html);
    const buffer = await page.screenshot({ type: 'png', omitBackground: false, clip: { x: 0, y: 0, width: 512, height: 512 } });
    await browser.close();
    return buffer;
}

// Cek apakah teks mengandung emoji
function hasEmoji(text) {
    const emojiRegex = /[\u{1f300}-\u{1f5ff}\u{1f900}-\u{1f9ff}\u{1f600}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}\u{1f1e6}-\u{1f1ff}\u{1f191}-\u{1f251}\u{1f004}\u{1f0cf}\u{1f170}-\u{1f171}\u{1f17e}-\u{1f17f}\u{1f18e}\u{3030}\u{2b50}\u{2b55}\u{2934}-\u{2935}\u{2b05}-\u{2b07}\u{2b1b}-\u{2b1c}\u{3297}\u{3299}\u{303d}\u{00a9}\u{00ae}\u{2122}\u{23f3}\u{24c2}\u{23e9}-\u{23ef}\u{25b6}\u{23f8}-\u{23fa}]/gu;
    return emojiRegex.test(text);
}

module.exports = {
    name: "stext",
    alias: ["stickertext", "stikerteks", "stextsharp"],
    description: "Membuat stiker dari teks dengan emoji berwarna.",
    category: "converter",
    execute: async (msg, { bot, args, usedPrefix, command }) => {
        const text = args.join(' ');
        if (!text) return msg.reply(`Gunakan: ${usedPrefix + command} <teks>\nContoh: ${usedPrefix + command} Hello 😄`);

        if (text.length > 80) return msg.reply('❌ Teks terlalu panjang! Maksimal 80 karakter.');

        try {
            await msg.react("🎨");
            console.log(`🎭 Processing stext: "${text}"`);

            let imageBuffer;
            let method = 'unknown';

            // 1. Puppeteer
            try {
                console.log('🧪 Trying Puppeteer method...');
                imageBuffer = await generateImageWithPuppeteer(text);
                method = 'puppeteer';
            } catch (error) {
                console.log('⚠️ Puppeteer failed:', error.message);

                // 2. Canvas
                try {
                    console.log('🖌️ Trying Canvas method...');
                    imageBuffer = await generateCanvasImage(text);
                    method = 'canvas';
                } catch (error2) {
                    console.log('⚠️ Canvas failed:', error2.message);

                    // 3. Sharp
                    try {
                        imageBuffer = await generateSharpImage(text);
                        method = 'sharp-enhanced';
                    } catch (error3) {
                        console.log('⚠️ Sharp failed:', error3.message);

                        // 4. SVG basic fallback
                        const svgContent = generateColorEmojiSVG(text);
                        imageBuffer = await sharp(Buffer.from(svgContent)).png().resize(512, 512).toBuffer();
                        method = 'svg-basic';
                    }
                }
            }

            const sticker = new Sticker(imageBuffer, {
                pack: process.env.stickerPackname || 'Color Emoji Stickers',
                author: process.env.stickerAuthor || 'Bot',
                type: StickerTypes.FULL,
                quality: 90,
            });

            const stickerBuffer = await sticker.toMessage();
            await bot.sendMessage(msg.from, stickerBuffer, { quoted: msg });
            await msg.react("✅");
            console.log(`✅ Stiker dikirim dengan metode: ${method}`);
        } catch (error) {
            console.error("❌ Error pada perintah stext:", error);
            await msg.react("❌");
            msg.reply(`❌ Gagal membuat stiker.\n\n🔍 Info:\n- Text: "${text}"\n- Has emoji: ${hasEmoji(text)}\n- Error: ${error.message}\n\n💡 Tips:\n- Install Puppeteer: \`npm install puppeteer\`\n- Install font: \`sudo apt install fonts-noto-color-emoji\`\n- Pastikan VPS bisa menjalankan Chromium (Puppeteer)`);
        }
    }
};
