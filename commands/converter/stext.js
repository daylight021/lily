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

// Generate SVG dengan emoji support
function generateSVG(text) {
    const lines = formatText(text);
    const fontSize = lines.length > 2 ? 36 : lines.length > 1 ? 42 : 48;
    const lineHeight = fontSize * 1.3;
    const totalHeight = lines.length * lineHeight;
    const startY = (512 - totalHeight) / 2 + fontSize;
    
    // Create gradient background
    const backgroundGradient = `
        <defs>
            <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
            </linearGradient>
            <filter id="dropshadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000000" flood-opacity="0.3"/>
            </filter>
        </defs>`;
    
    // Process each line
    const textElements = lines.map((line, index) => {
        const y = startY + (index * lineHeight);
        const processedLine = processFormatting(escapeHtml(line));
        
        return `
            <text x="256" y="${y}" 
                  text-anchor="middle" 
                  font-family="Segoe UI, Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif"
                  font-size="${fontSize}" 
                  fill="#ffffff" 
                  filter="url(#dropshadow)">
                ${processedLine}
            </text>`;
    }).join('');
    
    const svg = `
    <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
        ${backgroundGradient}
        
        <!-- Background -->
        <rect width="512" height="512" fill="url(#bgGradient)"/>
        
        <!-- Container background -->
        <rect x="32" y="64" width="448" height="384" 
              rx="20" ry="20" 
              fill="rgba(255,255,255,0.95)" 
              filter="url(#dropshadow)"/>
        
        <!-- Border -->
        <rect x="32" y="64" width="448" height="384" 
              rx="20" ry="20" 
              fill="none" 
              stroke="rgba(255,255,255,0.3)" 
              stroke-width="2"/>
        
        <!-- Text content -->
        <g transform="translate(0, 0)">
            ${textElements}
        </g>
    </svg>`;
    
    return svg;
}

// Alternative: Simple Sharp-based text rendering
async function generateSimpleImage(text) {
    const lines = formatText(text);
    const fontSize = lines.length > 2 ? 36 : lines.length > 1 ? 42 : 48;
    
    // Create base image with gradient background
    const gradient = await sharp({
        create: {
            width: 512,
            height: 512,
            channels: 4,
            background: { r: 102, g: 126, b: 234, alpha: 1 }
        }
    })
    .composite([
        {
            input: Buffer.from(`
                <svg width="512" height="512">
                    <defs>
                        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" style="stop-color:#667eea" />
                            <stop offset="100%" style="stop-color:#764ba2" />
                        </linearGradient>
                    </defs>
                    <rect width="512" height="512" fill="url(#grad)"/>
                    <rect x="32" y="64" width="448" height="384" rx="20" fill="rgba(255,255,255,0.95)"/>
                </svg>
            `),
            top: 0,
            left: 0
        }
    ])
    .png()
    .toBuffer();
    
    return gradient;
}

module.exports = {
    name: "stext",
    alias: ["stickertext", "stikerteks", "stextsharp"],
    description: "Membuat stiker dari teks dengan Sharp (fallback method).",
    category: "converter",
    execute: async (msg, { bot, args, usedPrefix, command }) => {
        const text = args.join(' ');
        if (!text) {
            return msg.reply(`Kirim perintah dengan format:\n*${usedPrefix + command} <teks kamu>*\n\nFormat yang didukung:\n- *bold* untuk tebal\n- _italic_ untuk miring\n- ~strikethrough~ untuk coret\n- Basic emoji support\n\nContoh: ${usedPrefix + command} Hello *World* 🎉`);
        }

        if (text.length > 80) {
            return msg.reply('❌ Teks terlalu panjang! Maksimal 80 karakter.');
        }

        try {
            await msg.react("🎨");
            console.log(`🎭 Processing stext with Sharp: "${text}"`);
            
            // Generate SVG
            const svgContent = generateSVG(text);
            
            // Convert SVG to PNG using Sharp
            const imageBuffer = await sharp(Buffer.from(svgContent))
                .png()
                .resize(512, 512)
                .toBuffer();
            
            console.log(`📦 Image buffer size: ${imageBuffer.length} bytes`);
            
            // Create sticker
            const sticker = new Sticker(imageBuffer, {
                pack: process.env.stickerPackname || 'Sharp Text Stickers',
                author: process.env.stickerAuthor || 'Sharp Bot',
                type: StickerTypes.FULL,
                quality: 90,
            });

            await bot.sendMessage(msg.from, await sticker.toMessage(), { quoted: msg });
            await msg.react("✅");
            
            console.log('✅ Sharp text sticker sent successfully');
            
        } catch (error) {
            console.error("❌ Error pada perintah stext Sharp:", error);
            await msg.react("❌");
            
            // Fallback ke simple version
            try {
                console.log('🔄 Trying simple fallback...');
                const simpleBuffer = await generateSimpleImage(text);
                
                const sticker = new Sticker(simpleBuffer, {
                    pack: process.env.stickerPackname || 'Simple Text Stickers',
                    author: process.env.stickerAuthor || 'Fallback Bot',
                    type: StickerTypes.FULL,
                    quality: 85,
                });

                await bot.sendMessage(msg.from, await sticker.toMessage(), { quoted: msg });
                await msg.react("✅");
                
                console.log('✅ Fallback sticker sent successfully');
                
            } catch (fallbackError) {
                console.error("❌ Fallback also failed:", fallbackError);
                msg.reply("Terjadi kesalahan saat membuat stiker teks.\n\n💡 Coba:\n- Teks lebih pendek\n- Tanpa karakter khusus\n- Install sharp: `npm install sharp`");
            }
        }
    }
};