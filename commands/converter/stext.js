const { createCanvas, registerFont } = require('canvas');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const path = require('path');
const fs = require('fs');

// Register fonts saat module dimuat
try {
    const fontsDir = path.join(__dirname, '../lib/fonts');
    
    // Register Noto Color Emoji font
    const emojiFont = path.join(fontsDir, 'NotoColorEmoji.ttf');
    if (fs.existsSync(emojiFont)) {
        registerFont(emojiFont, { family: 'Noto Color Emoji' });
        console.log('✅ Noto Color Emoji font loaded successfully');
    }
    
    // Register fallback fonts jika ada
    const notoSans = path.join(fontsDir, 'NotoSans-Regular.ttf');
    if (fs.existsSync(notoSans)) {
        registerFont(notoSans, { family: 'Noto Sans' });
    }
    
} catch (error) {
    console.warn('⚠️ Warning: Could not load custom fonts:', error.message);
}

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

// Fungsi untuk mendeteksi emoji
function containsEmoji(text) {
    const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
    return emojiRegex.test(text);
}

// Fungsi untuk memisahkan teks dan emoji
function parseTextAndEmoji(text) {
    const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
    const parts = [];
    let lastIndex = 0;
    let match;
    
    while ((match = emojiRegex.exec(text)) !== null) {
        // Tambahkan teks sebelum emoji
        if (match.index > lastIndex) {
            parts.push({
                type: 'text',
                content: text.slice(lastIndex, match.index)
            });
        }
        
        // Tambahkan emoji
        parts.push({
            type: 'emoji',
            content: match[0]
        });
        
        lastIndex = match.index + match[0].length;
    }
    
    // Tambahkan sisa teks
    if (lastIndex < text.length) {
        parts.push({
            type: 'text',
            content: text.slice(lastIndex)
        });
    }
    
    return parts;
}

// Fungsi untuk menggambar teks dengan format dan emoji
function drawTextWithFormatting(ctx, text, x, y, fontSize, fontFamily) {
    const formatParts = text.split(/([*_~])/);
    let currentX = x;
    let isBold = false;
    let isItalic = false;
    
    // Hitung total width untuk centering
    let totalWidth = 0;
    let tempBold = false, tempItalic = false;
    
    for (let i = 0; i < formatParts.length; i++) {
        const part = formatParts[i];
        if (part === '*') {
            tempBold = !tempBold;
            continue;
        }
        if (part === '_') {
            tempItalic = !tempItalic;
            continue;
        }
        if (part === '~') {
            i++; // Skip strikethrough text untuk perhitungan width
            continue;
        }
        
        const textParts = parseTextAndEmoji(part);
        for (const textPart of textParts) {
            if (textPart.type === 'emoji') {
                ctx.font = `${fontSize}px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji"`;
            } else {
                const fontStyle = `${tempItalic ? 'italic' : ''} ${tempBold ? 'bold' : ''} ${fontSize}px ${fontFamily}`;
                ctx.font = fontStyle.trim();
            }
            totalWidth += ctx.measureText(textPart.content).width;
        }
    }
    
    // Mulai dari posisi yang sudah di-center minus setengah total width
    currentX = x - (totalWidth / 2);

    for (let i = 0; i < formatParts.length; i++) {
        const part = formatParts[i];
        
        if (part === '*') {
            isBold = !isBold;
            continue;
        }
        if (part === '_') {
            isItalic = !isItalic;
            continue;
        }
        if (part === '~') {
            // Strikethrough logic
            const nextPart = formatParts[i + 1] || '';
            const textParts = parseTextAndEmoji(nextPart);
            
            for (const textPart of textParts) {
                if (textPart.type === 'emoji') {
                    ctx.font = `${fontSize}px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji"`;
                } else {
                    const fontStyle = `${isItalic ? 'italic' : ''} ${isBold ? 'bold' : ''} ${fontSize}px ${fontFamily}`;
                    ctx.font = fontStyle.trim();
                }
                
                const textWidth = ctx.measureText(textPart.content).width;
                ctx.fillText(textPart.content, currentX, y);
                
                // Draw strikethrough line
                ctx.beginPath();
                ctx.moveTo(currentX, y - (fontSize * 0.2));
                ctx.lineTo(currentX + textWidth, y - (fontSize * 0.2));
                ctx.stroke();
                
                currentX += textWidth;
            }
            i++; // Skip next part
            continue;
        }

        // Parse emoji dan teks biasa
        const textParts = parseTextAndEmoji(part);
        
        for (const textPart of textParts) {
            if (textPart.type === 'emoji') {
                // Set font untuk emoji
                ctx.font = `${fontSize}px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji"`;
                ctx.fillText(textPart.content, currentX, y);
                currentX += ctx.measureText(textPart.content).width;
            } else if (textPart.content.trim()) {
                // Set font untuk teks biasa
                const fontStyle = `${isItalic ? 'italic' : ''} ${isBold ? 'bold' : ''} ${fontSize}px ${fontFamily}`;
                ctx.font = fontStyle.trim();
                ctx.fillText(textPart.content, currentX, y);
                currentX += ctx.measureText(textPart.content).width;
            }
        }
    }
}

module.exports = {
    name: "stext",
    alias: ["stickertext", "stikerteks"],
    description: "Membuat stiker dari teks dengan format khusus dan dukungan emoji.",
    category: "converter",
    execute: async (msg, { bot, args, usedPrefix, command }) => {
        const text = args.join(' ');
        if (!text) return msg.reply(`Kirim perintah dengan format:\n*${usedPrefix + command} <teks kamu>*\n\nFormat yang didukung:\n- *bold* untuk tebal\n- _italic_ untuk miring\n- ~strikethrough~ untuk coret\n- 😀🎉 emoji berwarna`);

        try {
            await msg.react("🎨");
            const lines = formatText(text);

            const fontSize = 80;
            const fontFamily = 'Noto Sans, Arial, sans-serif'; 
            const padding = 30;

            // Buat canvas sementara untuk mengukur
            const tempCanvas = createCanvas(1, 1);
            const tempCtx = tempCanvas.getContext('2d');
            
            let maxWidth = 0;
            lines.forEach(line => {
                // Ukur dengan font yang berbeda untuk emoji dan teks
                const parts = parseTextAndEmoji(line.replace(/[*_~]/g, ''));
                let lineWidth = 0;
                
                parts.forEach(part => {
                    if (part.type === 'emoji') {
                        tempCtx.font = `${fontSize}px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji"`;
                    } else {
                        tempCtx.font = `bold ${fontSize}px ${fontFamily}`;
                    }
                    lineWidth += tempCtx.measureText(part.content).width;
                });
                
                if (lineWidth > maxWidth) maxWidth = lineWidth;
            });
            
            const requiredWidth = maxWidth + (padding * 2);
            const requiredHeight = (lines.length * fontSize) + ((lines.length + 1) * padding);
            const canvasSize = Math.max(requiredWidth, requiredHeight, 512); // Minimum 512px
            
            const canvas = createCanvas(canvasSize, canvasSize);
            const ctx = canvas.getContext('2d');

            // Background putih
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Setup untuk teks
            ctx.fillStyle = 'black';
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 2;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            // Hitung posisi vertikal
            const totalTextHeight = (lines.length * fontSize) + ((lines.length - 1) * padding);
            let startY = (canvas.height - totalTextHeight) / 2 + (fontSize / 2);

            lines.forEach((line, index) => {
                const y = startY + (index * (fontSize + padding));
                drawTextWithFormatting(ctx, line, canvas.width / 2, y, fontSize, fontFamily);
            });

            const imageBuffer = canvas.toBuffer('image/png');
            const sticker = new Sticker(imageBuffer, {
                pack: process.env.stickerPackname || 'Custom Stickers',
                author: process.env.stickerAuthor || 'Bot',
                type: StickerTypes.FULL,
                quality: 90,
            });

            await bot.sendMessage(msg.from, await sticker.toMessage(), { quoted: msg });
            await msg.react("✅");
            
        } catch (error) {
            console.error("Error pada perintah stext:", error);
            await msg.react("❌");
            msg.reply("Terjadi kesalahan saat membuat stiker teks. Pastikan font emoji telah terinstall dengan benar.");
        }
    },
};