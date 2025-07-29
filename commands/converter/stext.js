const { createCanvas, registerFont } = require('canvas');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const path = require('path');

const fontPath = path.join(__dirname, '..', '..', 'lib', 'fonts', 'NotoColorEmoji.ttf');
registerFont(fontPath, { family: 'Noto Color Emoji' });


// Fungsi untuk memformat teks agar pas di stiker
function formatText(text) {
    const words = text.split(' ');
    if (words.length > 0 && words.length <= 3) return [text];
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

// --- MENGGAMBAR TEKS DENGAN FORMAT (*bold*, _italic_, dll) ---
function drawTextWithFormatting(ctx, text, x, y, fontSize, fontFamily) {
    const parts = text.split(/([*_~])/); // Memisahkan teks berdasarkan karakter format
    let isBold = false;
    let isItalic = false;

    // Hitung total lebar teks untuk penempatan yang benar
    let totalWidth = 0;
    parts.forEach(part => {
        if (!['*', '_', '~'].includes(part)) {
            const fontStyle = `${isItalic ? 'italic' : ''} ${isBold ? 'bold' : ''} ${fontSize}px "${fontFamily}"`;
            ctx.font = fontStyle;
            totalWidth += ctx.measureText(part).width;
        } else {
            if (part === '*') isBold = !isBold;
            if (part === '_') isItalic = !isItalic;
        }
    });

    let currentX = x - (totalWidth / 2);
    isBold = false;
    isItalic = false;

    parts.forEach(part => {
        if (part === '*') {
            isBold = !isBold;
            return;
        }
        if (part === '_') {
            isItalic = !isItalic;
            return;
        }
        if (part === '~') {
            const textWidth = ctx.measureText(parts[i+1] || '').width;
            ctx.fillText(parts[i+1] || '', currentX, y);
            ctx.beginPath();
            ctx.moveTo(currentX - (textWidth / 2), y);
            ctx.lineTo(currentX + (textWidth / 2), y);
            ctx.stroke();
            currentX += textWidth;
            i++; 
            return;
        }
        
        const fontStyle = `${isItalic ? 'italic' : ''} ${isBold ? 'bold' : ''} ${fontSize}px "${fontFamily}"`;
        ctx.font = fontStyle;
        ctx.fillText(part, currentX, y);
        currentX += ctx.measureText(part).width;
    });
}


// --- LOGIKA UTAMA PERINTAH BOT ---
module.exports = {
    name: "stext",
    description: "Membuat stiker dari teks dengan dukungan emoji berwarna.",
    aliases: ["stickertxt", "sticktext"],
    async execute(message, options) {
        const text = options.args;
        if (!text) return message.reply("Mohon masukkan teks untuk dijadikan stiker. Contoh: .stext Hello World ✨");

        await message.react("⏳");

        try {
            const lines = formatText(text);
            
            // --- PENGATURAN KANVAS ---
            const fontFamily = 'Noto Color Emoji'; // Gunakan font yang sudah didaftarkan
            const fontSize = 60;
            const padding = 20;

            const tempCanvas = createCanvas(1, 1);
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.font = `${fontSize}px "${fontFamily}"`;
            
            const maxWidth = Math.max(...lines.map(line => tempCtx.measureText(line).width));
            const requiredWidth = maxWidth + (padding * 2);
            const requiredHeight = (lines.length * fontSize) + ((lines.length + 1) * padding);
            const canvasSize = Math.max(requiredWidth, requiredHeight, 512); // Ukuran minimal 512x512
            const canvas = createCanvas(canvasSize, canvasSize);
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = 'black';
            ctx.textBaseline = 'middle';
            
            const totalTextHeight = (lines.length * fontSize) + ((lines.length - 1) * (padding / 2));
            const startY = (canvas.height - totalTextHeight) / 2;

            lines.forEach((line, index) => {
                const y = startY + (index * (fontSize + (padding / 2)));
                drawTextWithFormatting(ctx, line, canvas.width / 2, y, fontSize, fontFamily);
            });

            const imageBuffer = canvas.toBuffer('image/png');
            const sticker = new Sticker(imageBuffer, {
                pack: process.env.stickerPackname || 'My Bot',
                author: process.env.stickerAuthor || 'Lily',
                type: StickerTypes.FULL,
                quality: 90,
            });

            await message.reply(await sticker.toMessage());
            await message.react("✅");

        } catch (error) {
            console.error("Error pada perintah stext:", error);
            await message.react("❌");
            message.reply("Terjadi kesalahan saat membuat stiker teks.");
        }
    }
};