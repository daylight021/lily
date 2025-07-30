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

// Generate SVG dengan emoji font support
function generateColorEmojiSVG(text) {
    const lines = formatText(text);
    const fontSize = lines.length > 2 ? 48 : lines.length > 1 ? 56 : 64;
    const lineHeight = fontSize * 1.2;
    const totalHeight = lines.length * lineHeight;
    const startY = (512 - totalHeight) / 2 + fontSize * 0.8;
    
    // Font stack untuk emoji support
    const fontFamily = '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", "Twitter Color Emoji", "EmojiOne Color", "Symbola", Arial, sans-serif';
    
    const textElements = lines.map((line, index) => {
        const y = startY + (index * lineHeight);
        const processedLine = processFormatting(escapeHtml(line));
        
        return `
            <text x="256" y="${y}" 
                  text-anchor="middle" 
                  font-family="${fontFamily}"
                  font-size="${fontSize}" 
                  fill="#333333"
                  dominant-baseline="middle">
                ${processedLine}
            </text>`;
    }).join('');
    
    const svg = `
    <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
        <!-- Background putih -->
        <rect width="512" height="512" fill="#ffffff"/>
        
        <!-- Teks dengan emoji support -->
        ${textElements}
    </svg>`;
    
    return svg;
}

// Canvas-based approach dengan better emoji support
async function generateCanvasImage(text) {
    try {
        const { createCanvas, registerFont } = require('canvas');
        
        // Try to register emoji fonts if available
        try {
            registerFont('/usr/share/fonts/truetype/NotoColorEmoji.ttf', { family: 'Noto Color Emoji' });
        } catch (e) {
            console.log('⚠️ Noto Color Emoji font not found, using system default');
        }
        
        const lines = formatText(text);
        const fontSize = lines.length > 2 ? 48 : lines.length > 1 ? 56 : 64;
        const lineHeight = fontSize * 1.2;
        
        const canvas = createCanvas(512, 512);
        const ctx = canvas.getContext('2d');
        
        // White background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 512, 512);
        
        // Text styling
        ctx.fillStyle = '#333333';
        ctx.font = `${fontSize}px "Noto Color Emoji", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Draw each line
        const totalHeight = lines.length * lineHeight;
        const startY = (512 - totalHeight) / 2 + lineHeight / 2;
        
        lines.forEach((line, index) => {
            const y = startY + (index * lineHeight);
            ctx.fillText(line, 256, y);
        });
        
        return canvas.toBuffer('image/png');
        
    } catch (error) {
        console.log('⚠️ Canvas not available:', error.message);
        throw error;
    }
}

// Sharp-based dengan improved font handling
async function generateSharpImage(text) {
    const lines = formatText(text);
    const fontSize = lines.length > 2 ? 48 : lines.length > 1 ? 56 : 64;
    const lineHeight = fontSize * 1.2;
    
    // Create white background
    let image = sharp({
        create: {
            width: 512,
            height: 512,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
    });
    
    // Calculate positioning
    const totalHeight = lines.length * lineHeight;
    const startY = (512 - totalHeight) / 2;
    
    const textOverlays = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const y = startY + (i * lineHeight);
        
        // Enhanced SVG with better font support
        const lineSvg = `
        <svg width="512" height="100" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <style>
                    .emoji-text {
                        font-family: "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", "Twitter Color Emoji", "EmojiOne Color", Arial, sans-serif;
                        font-size: ${fontSize}px;
                        fill: #333333;
                        text-anchor: middle;
                        dominant-baseline: middle;
                    }
                </style>
            </defs>
            <text x="256" y="50" class="emoji-text">
                ${escapeHtml(line)}
            </text>
        </svg>`;
        
        textOverlays.push({
            input: Buffer.from(lineSvg),
            top: Math.round(y - fontSize * 0.4),
            left: 0
        });
    }
    
    if (textOverlays.length > 0) {
        image = image.composite(textOverlays);
    }
    
    return await image.png().toBuffer();
}

// Detect if emoji is present in text
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
        if (!text) {
            return msg.reply(`Kirim perintah dengan format:\n*${usedPrefix + command} <teks kamu>*\n\nFormat yang didukung:\n- *bold* untuk tebal\n- _italic_ untuk miring\n- ~strikethrough~ untuk coret\n- Emoji berwarna 🎨\n\nContoh: ${usedPrefix + command} Hello *World* 🎉`);
        }

        if (text.length > 80) {
            return msg.reply('❌ Teks terlalu panjang! Maksimal 80 karakter.');
        }

        try {
            await msg.react("🎨");
            console.log(`🎭 Processing stext: "${text}"`);
            console.log(`📊 Has emoji: ${hasEmoji(text)}`);
            
            let imageBuffer;
            let method = 'unknown';
            
            try {
                // Method 1: Canvas (best for emoji)
                console.log('🖌️ Trying Canvas method...');
                imageBuffer = await generateCanvasImage(text);
                method = 'canvas';
                
            } catch (error) {
                console.log('⚠️ Canvas failed, trying Sharp with enhanced SVG...');
                
                try {
                    // Method 2: Sharp with enhanced SVG
                    imageBuffer = await generateSharpImage(text);
                    method = 'sharp-enhanced';
                    
                } catch (error2) {
                    console.log('⚠️ Enhanced Sharp failed, trying basic SVG...');
                    
                    // Method 3: Basic SVG
                    const svgContent = generateColorEmojiSVG(text);
                    imageBuffer = await sharp(Buffer.from(svgContent))
                        .png()
                        .resize(512, 512)
                        .toBuffer();
                    method = 'svg-basic';
                }
            }
            
            console.log(`📦 Generated with ${method}, buffer size: ${imageBuffer.length} bytes`);
            
            if (!imageBuffer || imageBuffer.length === 0) {
                throw new Error('Generated image buffer is empty');
            }
            
            // Create sticker
            const sticker = new Sticker(imageBuffer, {
                pack: process.env.stickerPackname || 'Color Emoji Stickers',
                author: process.env.stickerAuthor || 'Bot',
                type: StickerTypes.FULL,
                quality: 90,
            });

            const stickerBuffer = await sticker.toMessage();
            await bot.sendMessage(msg.from, stickerBuffer, { quoted: msg });
            await msg.react("✅");
            
            console.log(`✅ Color emoji sticker sent successfully using ${method}`);
            
        } catch (error) {
            console.error("❌ Error pada perintah stext:", error);
            await msg.react("❌");
            
            msg.reply(`❌ Terjadi kesalahan saat membuat stiker teks.\n\n🔍 Debug info:\n- Text: "${text}"\n- Has emoji: ${hasEmoji(text)}\n- Error: ${error.message}\n\n💡 Untuk emoji berwarna:\n1. Install font emoji: \`sudo apt install fonts-noto-color-emoji\`\n2. Install canvas: \`npm install canvas\`\n3. Restart bot setelah install`);
        }
    }
};