const { createCanvas } = require('canvas');
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

// --- MENGGAMBAR TEKS DENGAN FORMAT ---
function drawTextWithFormatting(ctx, text, x, y, fontSize, fontFamily) {
    const parts = text.split(/([*_~])/); // Memisahkan teks berdasarkan karakter format
    let currentX = x;
    let isBold = false;
    let isItalic = false;

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part === '*') {
            isBold = !isBold;
            continue;
        }
        if (part === '_') {
            isItalic = !isItalic;
            continue;
        }
        if (part === '~') {
            // Logika untuk strikethrough
            const textWidth = ctx.measureText(parts[i+1] || '').width;
            ctx.fillText(parts[i+1] || '', currentX, y);
            ctx.beginPath();
            ctx.moveTo(currentX - (textWidth / 2), y);
            ctx.lineTo(currentX + (textWidth / 2), y);
            ctx.stroke();
            currentX += textWidth;
            i++; 
            continue;
        }

        const fontStyle = `${isItalic ? 'italic' : ''} ${isBold ? 'bold' : ''} ${fontSize}px ${fontFamily}`;
        ctx.font = fontStyle.trim();
        ctx.fillText(part, currentX, y);
        currentX += ctx.measureText(part).width;
    }
}


module.exports = {
    name: "stext",
    alias: ["stickertext", "stikerteks"],
    description: "Membuat stiker dari teks dengan format khusus.",
    category: "converter",
    execute: async (msg, { bot, args, usedPrefix, command }) => {
        const text = args.join(' ');
        if (!text) return msg.reply(`Kirim perintah dengan format:\n*${usedPrefix + command} <teks kamu>*`);

        try {
            await msg.react("🎨");
            const lines = formatText(text);

            const fontSize = 80;
            const fontFamily = 'sans-serif'; 
            const padding = 30;

            const tempCanvas = createCanvas(1, 1);
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.font = `bold ${fontSize}px ${fontFamily}`;

            let maxWidth = 0;
            lines.forEach(line => {
                const metrics = tempCtx.measureText(line.replace(/[*_~]/g, '')); 
                if (metrics.width > maxWidth) maxWidth = metrics.width;
            });
            
            const requiredWidth = maxWidth + (padding * 2);
            const requiredHeight = (lines.length * fontSize) + ((lines.length + 1) * padding);
            const canvasSize = Math.max(requiredWidth, requiredHeight);
            const canvas = createCanvas(canvasSize, canvasSize);
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = 'black';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            const totalTextHeight = (lines.length * fontSize) + ((lines.length - 1) * padding);
            const startY = (canvas.height - totalTextHeight) / 2;

            lines.forEach((line, index) => {
                const y = startY + (index * (fontSize + padding));
                drawTextWithFormatting(ctx, line, canvas.width / 2, y, fontSize, fontFamily);
            });

            const imageBuffer = canvas.toBuffer('image/png');
            const sticker = new Sticker(imageBuffer, {
                pack: process.env.stickerPackname,
                author: process.env.stickerAuthor,
                type: StickerTypes.FULL,
                quality: 90,
            });

            await bot.sendMessage(msg.from, await sticker.toMessage(), { quoted: msg });
        } catch (error) {
            console.error("Error pada perintah stext:", error);
            await msg.react("❌");
            msg.reply("Terjadi kesalahan saat membuat stiker teks.");
        }
    },
};