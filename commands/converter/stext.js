const { createCanvas, registerFont } = require('canvas');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const path = require('path');

// Mendaftarkan font emoji berwarna
try {
    const fontPath = path.join(__dirname, '..', '..', 'lib', 'fonts', 'NotoColorEmoji.ttf');
    // Pastikan file font ada sebelum mendaftarkannya
    if (require('fs').existsSync(fontPath)) {
        registerFont(fontPath, { family: 'Noto Color Emoji' });
    } else {
        console.warn(`[stext] Peringatan: Font NotoColorEmoji.ttf tidak ditemukan di ${fontPath}. Emoji mungkin tidak berwarna.`);
    }
} catch (e) {
    console.error('[stext] Gagal mendaftarkan font emoji:', e);
}


// Fungsi untuk memformat teks (dibuat lebih aman)
function formatText(text) {
    // Pastikan input selalu string sebelum di-split
    const safeText = String(text); 
    const words = safeText.split(' ');
    if (words.length > 0 && words.length <= 3) return [safeText];
    
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

// Fungsi menggambar teks
function drawTextWithFormatting(ctx, text, x, y, fontSize, fontFamily) {
    const parts = String(text).split(/([*_~])/);
    let isBold = false;
    let isItalic = false;

    let totalWidth = 0;
    ctx.font = `${fontSize}px "${fontFamily}"`;
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
        if (part === '*' || part === '_' || part === '~') {
            if (part === '*') isBold = !isBold;
            if (part === '_') isItalic = !isItalic;
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
        // --- Langkah Debugging ---
        // Kita akan log tipe dan isi dari argumen yang diterima
        console.log(`[stext debug] Tipe dari 'options.args': ${typeof options.args}`);
        console.log(`[stext debug] Isi dari 'options.args':`, options.args);

        // --- Kode Defensif ---
        // Secara paksa ubah argumen menjadi string untuk menghindari error.
        // Jika options.args tidak ada, `String(undefined)` akan menjadi "undefined", jadi kita tangani itu.
        let text = (options && typeof options.args !== 'undefined' && options.args !== null) ? String(options.args) : "";
        
        if (!text || text.trim().length === 0) {
            return message.reply("Mohon masukkan teks untuk dijadikan stiker. Contoh: .stext Hello World ✨");
        }

        await message.react("⏳");

        try {
            const lines = formatText(text);
            const fontFamily = 'Noto Color Emoji';
            const fontSize = 60;
            const padding = 20;

            const tempCanvas = createCanvas(1, 1);
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.font = `${fontSize}px "${fontFamily}"`;
            
            const maxWidth = Math.max(...lines.map(line => {
                const parts = String(line).split(/([*_~])/);
                let width = 0;
                parts.forEach(part => {
                    if (!['*', '_', '~'].includes(part)) width += tempCtx.measureText(part).width;
                });
                return width;
            }));

            const requiredWidth = maxWidth + (padding * 2);
            const requiredHeight = (lines.length * fontSize) + ((lines.length + 1) * padding);
            const canvasSize = Math.max(requiredWidth, requiredHeight, 512);
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