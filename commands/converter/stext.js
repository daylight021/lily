const puppeteer = require('puppeteer');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const path = require('path');
const fs = require('fs');

// Cache browser instance untuk performance
let browserInstance = null;

async function getBrowser() {
    if (!browserInstance) {
        try {
            browserInstance = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-extensions',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding'
                ],
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
            });
            
            console.log('✅ Browser launched successfully');
            
            // Graceful shutdown
            process.on('exit', async () => {
                if (browserInstance) {
                    await browserInstance.close();
                }
            });
            
            process.on('SIGINT', async () => {
                if (browserInstance) {
                    await browserInstance.close();
                }
                process.exit();
            });
            
        } catch (error) {
            console.error('❌ Failed to launch browser:', error.message);
            throw error;
        }
    }
    return browserInstance;
}

// Fungsi untuk memformat teks dengan HTML
function formatTextToHTML(text) {
    const words = text.split(' ');
    let lines = [];
    
    if (words.length <= 3) {
        lines = words;
    } else {
        let currentLine = [];
        for (let i = 0; i < words.length; i++) {
            currentLine.push(words[i]);
            const wordsPerLine = (words.length - i > 3) ? 3 : 2;
            if (currentLine.length >= wordsPerLine || i === words.length - 1) {
                lines.push(currentLine.join(' '));
                currentLine = [];
            }
        }
    }
    
    // Convert format markers to HTML with better regex
    return lines.map(line => {
        return line
            .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
            .replace(/_([^_]+)_/g, '<em>$1</em>')
            .replace(/~([^~]+)~/g, '<del>$1</del>');
    }).join('<br>');
}

// Fungsi untuk generate CSS berdasarkan konten
function generateCSS(hasEmoji, lineCount) {
    const fontSize = lineCount > 2 ? 40 : lineCount > 1 ? 48 : 56;
    
    return `
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'EmojiOne Color', system-ui, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            width: 512px;
            height: 512px;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            margin: 0;
            padding: 0;
        }
        
        .container {
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            padding: 40px 30px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            max-width: 450px;
            text-align: center;
            position: relative;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.3);
        }
        
        .container::before {
            content: '';
            position: absolute;
            top: -2px;
            left: -2px;
            right: -2px;
            bottom: -2px;
            background: linear-gradient(45deg, #667eea, #764ba2, #f093fb, #f5576c);
            border-radius: 22px;
            z-index: -1;
            opacity: 0.8;
        }
        
        .text-content {
            font-size: ${fontSize}px;
            line-height: 1.4;
            color: #2c3e50;
            font-weight: 500;
            word-wrap: break-word;
            hyphens: auto;
            text-rendering: optimizeLegibility;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }
        
        .text-content strong {
            font-weight: 700;
            color: #1a202c;
        }
        
        .text-content em {
            font-style: italic;
            color: #4a5568;
        }
        
        .text-content del {
            text-decoration: line-through;
            color: #718096;
            opacity: 0.8;
        }
    `;
}

// Fungsi untuk wait dengan Promise
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Main function untuk generate image
async function generateTextImage(text) {
    let page = null;
    
    try {
        const browser = await getBrowser();
        page = await browser.newPage();
        
        // Setup viewport dengan device scale factor
        await page.setViewport({ 
            width: 512, 
            height: 512,
            deviceScaleFactor: 1 // Kurangi untuk performa
        });
        
        // Count lines and detect emoji
        const wordCount = text.split(/\s+/).length;
        const lines = wordCount > 3 ? Math.ceil(wordCount / 3) : 1;
        const hasEmoji = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu.test(text);
        
        const formattedText = formatTextToHTML(text);
        const css = generateCSS(hasEmoji, lines);
        
        const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>${css}</style>
        </head>
        <body>
            <div class="container">
                <div class="text-content">${formattedText}</div>
            </div>
        </body>
        </html>`;
        
        console.log('🖼️ Setting page content...');
        await page.setContent(html, { 
            waitUntil: 'domcontentloaded',
            timeout: 10000 
        });
        
        // Wait for rendering
        console.log('⏳ Waiting for render...');
        await wait(1500);
        
        // Take screenshot
        console.log('📸 Taking screenshot...');
        const screenshot = await page.screenshot({
            type: 'png',
            clip: { x: 0, y: 0, width: 512, height: 512 },
            omitBackground: false
        });
        
        console.log('✅ Screenshot generated successfully');
        return screenshot;
        
    } catch (error) {
        console.error('❌ Error in generateTextImage:', error);
        throw error;
    } finally {
        if (page) {
            await page.close();
        }
    }
}

// Cleanup function untuk graceful shutdown
async function cleanup() {
    if (browserInstance) {
        try {
            await browserInstance.close();
            browserInstance = null;
            console.log('🧹 Browser instance closed');
        } catch (error) {
            console.error('Error closing browser:', error);
        }
    }
}

module.exports = {
    name: "stext",
    alias: ["stickertext", "stikerteks"],
    description: "Membuat stiker dari teks dengan emoji berwarna menggunakan Puppeteer.",
    category: "converter",
    execute: async (msg, { bot, args, usedPrefix, command }) => {
        const text = args.join(' ');
        if (!text) {
            return msg.reply(`Kirim perintah dengan format:\n*${usedPrefix + command} <teks kamu>*\n\nFormat yang didukung:\n- *bold* untuk tebal\n- _italic_ untuk miring\n- ~strikethrough~ untuk coret\n- 😀🎉 emoji berwarna penuh\n\nContoh: ${usedPrefix + command} Hello *World* 🎉`);
        }

        // Validasi panjang teks
        if (text.length > 100) {
            return msg.reply('❌ Teks terlalu panjang! Maksimal 100 karakter.');
        }

        try {
            await msg.react("🎨");
            console.log(`🎭 Processing stext command: "${text}"`);
            
            // Generate image using Puppeteer
            const imageBuffer = await generateTextImage(text);
            
            if (!imageBuffer || imageBuffer.length === 0) {
                throw new Error('Generated image buffer is empty');
            }
            
            console.log(`📦 Image buffer size: ${imageBuffer.length} bytes`);
            
            // Create sticker
            const sticker = new Sticker(imageBuffer, {
                pack: process.env.stickerPackname || 'Colorful Text Stickers',
                author: process.env.stickerAuthor || 'Puppeteer Bot',
                type: StickerTypes.FULL,
                quality: 90,
            });

            console.log('🎁 Converting to sticker...');
            const stickerMessage = await sticker.toMessage();
            
            await bot.sendMessage(msg.from, stickerMessage, { quoted: msg });
            await msg.react("✅");
            
            console.log('✅ Text sticker sent successfully');
            
        } catch (error) {
            console.error("❌ Error pada perintah stext:", error);
            await msg.react("❌");
            
            let errorMsg = "Terjadi kesalahan saat membuat stiker teks.";
            
            if (error.message.includes('browserInstance') || error.message.includes('browser')) {
                errorMsg += "\n\n🔧 Browser error. Install: `sudo apt install chromium-browser`";
            } else if (error.message.includes('timeout') || error.message.includes('Navigation')) {
                errorMsg += "\n\n⏱️ Timeout error. Server mungkin sedang lambat.";
            } else if (error.message.includes('memory') || error.message.includes('Memory')) {
                errorMsg += "\n\n💾 Memory error. Coba teks yang lebih pendek.";
            } else if (error.message.includes('launch') || error.message.includes('executable')) {
                errorMsg += "\n\n🚀 Browser launch error. Cek PUPPETEER_EXECUTABLE_PATH.";
            } else {
                errorMsg += `\n\n🔍 Detail: ${error.message.substring(0, 100)}`;
            }
            
            msg.reply(errorMsg);
        }
    },
    
    // Export cleanup function
    cleanup: cleanup
};