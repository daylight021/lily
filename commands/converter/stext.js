const puppeteer = require('puppeteer');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const path = require('path');
const fs = require('fs');

// Cache browser instance untuk performance
let browserInstance = null;

async function getBrowser() {
    if (!browserInstance) {
        browserInstance = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--single-process', // Important for VPS
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser'
        });
        
        // Graceful shutdown
        process.on('exit', async () => {
            if (browserInstance) {
                await browserInstance.close();
            }
        });
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
    
    // Convert format markers to HTML
    return lines.map(line => {
        return line
            .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
            .replace(/_([^_]+)_/g, '<em>$1</em>')
            .replace(/~([^~]+)~/g, '<del>$1</del>');
    }).join('<br>');
}

// Fungsi untuk generate CSS berdasarkan konten
function generateCSS(hasEmoji, lineCount) {
    const fontSize = lineCount > 2 ? 44 : lineCount > 1 ? 52 : 60;
    const containerHeight = Math.max(400, lineCount * 80 + 160);
    
    return `
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans:ital,wght@0,400;0,700;1,400;1,700&display=swap');
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Noto Sans', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'EmojiOne Color', sans-serif;
            background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
            width: 512px;
            height: 512px;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
        }
        
        .container {
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            padding: 40px 30px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
            max-width: 450px;
            text-align: center;
            position: relative;
        }
        
        .container::before {
            content: '';
            position: absolute;
            top: -2px;
            left: -2px;
            right: -2px;
            bottom: -2px;
            background: linear-gradient(45deg, #667eea, #764ba2, #f093fb, #f5576c, #4facfe, #00f2fe);
            border-radius: 22px;
            z-index: -1;
            opacity: 0.6;
        }
        
        .text-content {
            font-size: ${fontSize}px;
            line-height: 1.3;
            color: #2c3e50;
            font-weight: 500;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
            word-wrap: break-word;
            hyphens: auto;
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
        
        /* Enhanced emoji rendering */
        .text-content {
            font-feature-settings: "liga" on, "clig" on, "kern" on;
            text-rendering: optimizeLegibility;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }
        
        /* Responsive adjustments */
        @media (max-width: 512px) {
            .container {
                padding: 30px 20px;
                max-width: 400px;
            }
            .text-content {
                font-size: ${Math.max(fontSize - 8, 32)}px;
            }
        }
    `;
}

// Main function untuk generate image
async function generateTextImage(text) {
    const browser = await getBrowser();
    const page = await browser.newPage();
    
    try {
        // Setup viewport
        await page.setViewport({ 
            width: 512, 
            height: 512, 
            deviceScaleFactor: 2 // Higher DPI for better quality
        });
        
        // Count lines and detect emoji
        const lines = text.split(/\s+/).length > 3 ? 
            Math.ceil(text.split(/\s+/).length / 3) : 1;
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
        
        await page.setContent(html, { waitUntil: 'networkidle2' });
        
        // Wait for fonts to load
        await page.waitForTimeout(1000);
        
        // Take screenshot
        const screenshot = await page.screenshot({
            type: 'png',
            clip: { x: 0, y: 0, width: 512, height: 512 },
            omitBackground: false
        });
        
        return screenshot;
        
    } catch (error) {
        console.error('Error generating image:', error);
        throw error;
    } finally {
        await page.close();
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
            return msg.reply(`Kirim perintah dengan format:\n*${usedPrefix + command} <teks kamu>*\n\nFormat yang didukung:\n- *bold* untuk tebal\n- _italic_ untuk miring\n- ~strikethrough~ untuk coret\n- 😀🎉 emoji berwarna penuh\n\nContoh: ${usedPrefix + command} Hello *World* 🎉 _amazing_ text!`);
        }

        try {
            await msg.react("🎨");
            
            // Generate image using Puppeteer
            console.log('🖼️ Generating text image with Puppeteer...');
            const imageBuffer = await generateTextImage(text);
            
            // Create sticker
            const sticker = new Sticker(imageBuffer, {
                pack: process.env.stickerPackname || 'Colorful Text Stickers',
                author: process.env.stickerAuthor || 'Puppeteer Bot',
                type: StickerTypes.FULL,
                quality: 95,
            });

            await bot.sendMessage(msg.from, await sticker.toMessage(), { quoted: msg });
            await msg.react("✅");
            
            console.log('✅ Text sticker generated successfully');
            
        } catch (error) {
            console.error("Error pada perintah stext:", error);
            await msg.react("❌");
            
            let errorMsg = "Terjadi kesalahan saat membuat stiker teks.";
            
            if (error.message.includes('chromium') || error.message.includes('browser')) {
                errorMsg += "\n\n🔧 Install Chromium:\n`sudo apt install chromium-browser`";
            } else if (error.message.includes('timeout')) {
                errorMsg += "\n\n⏱️ Server sedang lambat, coba lagi sebentar.";
            } else if (error.message.includes('memory')) {
                errorMsg += "\n\n💾 Teks terlalu panjang, coba yang lebih pendek.";
            }
            
            msg.reply(errorMsg);
        }
    },
    
    // Cleanup function
    cleanup: async () => {
        if (browserInstance) {
            await browserInstance.close();
            browserInstance = null;
            console.log('🧹 Browser instance closed');
        }
    }
};