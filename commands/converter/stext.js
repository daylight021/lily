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

// Fungsi untuk escape HTML entities
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Fungsi untuk process format text ke HTML
function processFormatting(text) {
    return text
        .replace(/\*([^*]+)\*/g, '<tspan font-weight="bold">$1</tspan>')
        .replace(/_([^_]+)_/g, '<tspan font-style="italic">$1</tspan>')
        .replace(/~([^~]+)~/g, '<tspan text-decoration="line-through">$1</tspan>');
}

// Generate SVG dengan background putih dan emoji support yang lebih baik
function generateSVG(text) {
    const lines = formatText(text);
    const fontSize = lines.length > 2 ? 48 : lines.length > 1 ? 56 : 64;
    const lineHeight = fontSize * 1.2;
    const totalHeight = lines.length * lineHeight;
    const startY = (512 - totalHeight) / 2 + fontSize * 0.8;
    
    // Simplified SVG dengan background putih
    const textElements = lines.map((line, index) => {
        const y = startY + (index * lineHeight);
        const processedLine = processFormatting(escapeHtml(line));
        
        return `<text x="256" y="${y}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" fill="#333333">${processedLine}</text>`;
    }).join('');
    
    const svg = `
    <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
        <!-- Background putih -->
        <rect width="512" height="512" fill="#ffffff"/>
        
        <!-- Teks -->
        ${textElements}
    </svg>`;
    
    return svg;
}

// Alternative: Canvas-like approach dengan Sharp
async function generateSimpleTextImage(text) {
    const lines = formatText(text);
    const fontSize = lines.length > 2 ? 48 : lines.length > 1 ? 56 : 64;
    const lineHeight = fontSize * 1.2;
    
    // Base white background
    let image = sharp({
        create: {
            width: 512,
            height: 512,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
    });
    
    // Calculate text positioning
    const totalHeight = lines.length * lineHeight;
    const startY = (512 - totalHeight) / 2;
    
    // Create text overlays
    const textOverlays = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const y = startY + (i * lineHeight);
        
        // Create SVG for each line (simpler approach)
        const lineSvg = `
        <svg width="512" height="100">
            <text x="256" y="50" text-anchor="middle" 
                  font-family="Arial, Helvetica, sans-serif" 
                  font-size="${fontSize}" 
                  fill="#333333" 
                  font-weight="normal">
                ${escapeHtml(line)}
            </text>
        </svg>`;
        
        textOverlays.push({
            input: Buffer.from(lineSvg),
            top: Math.round(y - fontSize * 0.8),
            left: 0
        });
    }
    
    // Apply all text overlays
    if (textOverlays.length > 0) {
        image = image.composite(textOverlays);
    }
    
    return await image.png().toBuffer();
}

// Fallback method - Pure text without emoji complications
async function generateBasicTextImage(text) {
    const lines = formatText(text);
    const fontSize = lines.length > 2 ? 40 : lines.length > 1 ? 48 : 56;
    
    // Simple SVG approach
    const svgText = lines.map((line, index) => {
        const y = 256 + (index - (lines.length - 1) / 2) * (fontSize * 1.3);
        return `<text x="256" y="${y}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" fill="#222222">${escapeHtml(line)}</text>`;
    }).join('');
    
    const simpleSvg = `
    <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
        <rect width="512" height="512" fill="white"/>
        ${svgText}
    </svg>`;
    
    return await sharp(Buffer.from(simpleSvg))
        .png()
        .toBuffer();
}

module.exports = {
    name: "stext",
    alias: ["stickertext", "stikerteks", "stextsharp"],
    description: "Membuat stiker dari teks dengan background putih.",
    category: "converter",
    execute: async (msg, { bot, args, usedPrefix, command }) => {
        const text = args.join(' ');
        if (!text) {
            return msg.reply(`Kirim perintah dengan format:\n*${usedPrefix + command} <teks kamu>*\n\nFormat yang didukung:\n- *bold* untuk tebal\n- _italic_ untuk miring\n- ~strikethrough~ untuk coret\n- Emoji support\n\nContoh: ${usedPrefix + command} Hello *World* 🎉`);
        }

        if (text.length > 80) {
            return msg.reply('❌ Teks terlalu panjang! Maksimal 80 karakter.');
        }

        try {
            await msg.react("🎨");
            console.log(`🎭 Processing stext: "${text}"`);
            
            let imageBuffer;
            
            try {
                // Method 1: Improved text rendering
                console.log('📝 Trying improved text rendering...');
                imageBuffer = await generateSimpleTextImage(text);
                
            } catch (error) {
                console.log('⚠️ Method 1 failed, trying basic SVG...');
                
                try {
                    // Method 2: Basic SVG
                    imageBuffer = await generateBasicTextImage(text);
                    
                } catch (error2) {
                    console.log('⚠️ Method 2 failed, trying original SVG...');
                    
                    // Method 3: Original SVG method
                    const svgContent = generateSVG(text);
                    imageBuffer = await sharp(Buffer.from(svgContent))
                        .png()
                        .resize(512, 512)
                        .toBuffer();
                }
            }
            
            console.log(`📦 Image buffer size: ${imageBuffer.length} bytes`);
            
            // Verify buffer is not empty
            if (!imageBuffer || imageBuffer.length === 0) {
                throw new Error('Generated image buffer is empty');
            }
            
            // Create sticker
            const sticker = new Sticker(imageBuffer, {
                pack: process.env.stickerPackname || 'Text Stickers',
                author: process.env.stickerAuthor || 'Bot',
                type: StickerTypes.FULL,
                quality: 90,
                background: 'transparent' // This helps with WhatsApp rendering
            });

            const stickerBuffer = await sticker.toMessage();
            await bot.sendMessage(msg.from, stickerBuffer, { quoted: msg });
            await msg.react("✅");
            
            console.log('✅ Text sticker sent successfully');
            
        } catch (error) {
            console.error("❌ Error pada perintah stext:", error);
            await msg.react("❌");
            
            // Debug info
            console.log('🔍 Debug info:', {
                textLength: text.length,
                hasEmoji: /[\u{1f300}-\u{1f5ff}\u{1f900}-\u{1f9ff}\u{1f600}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}\u{1f1e6}-\u{1f1ff}\u{1f191}-\u{1f251}\u{1f004}\u{1f0cf}\u{1f170}-\u{1f171}\u{1f17e}-\u{1f17f}\u{1f18e}\u{3030}\u{2b50}\u{2b55}\u{2934}-\u{2935}\u{2b05}-\u{2b07}\u{2b1b}-\u{2b1c}\u{3297}\u{3299}\u{303d}\u{00a9}\u{00ae}\u{2122}\u{23f3}\u{24c2}\u{23e9}-\u{23ef}\u{25b6}\u{23f8}-\u{23fa}]/gu.test(text),
                errorMessage: error.message
            });
            
            msg.reply(`❌ Terjadi kesalahan saat membuat stiker teks.\n\n🔍 Debug info:\n- Text: "${text}"\n- Length: ${text.length}\n- Error: ${error.message}\n\n💡 Coba:\n- Teks lebih pendek\n- Tanpa emoji kompleks\n- Pastikan Sharp terinstall: \`npm install sharp\``);
        }
    }
};