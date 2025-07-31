const axios = require('axios');
const FormData = require('form-data');
const { downloadMediaMessage } = require('lily-baileys');
const sharp = require('sharp'); // Untuk local processing fallback

/**
 * API endpoints yang masih bekerja berdasarkan research 2025
 */
const WORKING_APIS = {
    clipdrop: {
        url: 'https://clipdrop-api.co/image-upscaling/v1/upscale',
        name: 'ClipDrop',
        key: '5612c6468e60f8680f55a0f471007812fa5c2418489c5c2fe54dc2b62c95b7af39d12a3bdc92011286fc7b013324ab7e' // Ganti dengan API key Anda
    },
    deepai: {
        url: 'https://api.deepai.org/api/waifu2x',
        name: 'DeepAI',
        key: 'e72b5aa0-acc3-48b5-b4c5-54be052d29dd' // Free tier available
    },
    replicate: {
        url: 'https://api.replicate.com/v1/predictions',
        name: 'Replicate',
        model: 'jingyunliang/swinir'
    },
    upscalepics: {
        url: 'https://api.upscalepics.com/upscale',
        name: 'UpscalePics'
    },
    picwish: {
        url: 'https://www.picwish.com/api/upscale',
        name: 'Picwish'
    }
};

/**
 * Fungsi untuk enhance dengan DeepAI (Free Tier Available)
 */
async function enhanceWithDeepAI(imageBuffer) {
    try {
        console.log('🔄 Mencoba DeepAI Waifu2x...');
        
        const form = new FormData();
        form.append('image', imageBuffer, {
            filename: 'enhance.jpg',
            contentType: 'image/jpeg'
        });
        
        const response = await axios.post(WORKING_APIS.deepai.url, form, {
            headers: {
                ...form.getHeaders(),
                'api-key': 'quickstart-QUdJIGlzIGNvbWluZy4uLi4K', // Free demo key
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
            },
            timeout: 120000
        });
        
        if (response.data && response.data.output_url) {
            console.log('🔗 Downloading DeepAI result...');
            
            const imageResponse = await axios.get(response.data.output_url, {
                responseType: 'arraybuffer',
                timeout: 60000
            });
            
            const resultBuffer = Buffer.from(imageResponse.data);
            
            if (resultBuffer.length > imageBuffer.length * 1.1) {
                console.log(`✅ DeepAI berhasil: ${(resultBuffer.length / 1024 / 1024).toFixed(2)}MB`);
                return resultBuffer;
            } else {
                throw new Error('DeepAI: Hasil tidak menunjukkan peningkatan signifikan');
            }
        }
        
        throw new Error('DeepAI: Response tidak valid');
        
    } catch (error) {
        console.error('❌ DeepAI error:', error.message);
        throw error;
    }
}

/**
 * Fungsi untuk enhance dengan UpscalePics (Free API)
 */
async function enhanceWithUpscalePics(imageBuffer) {
    try {
        console.log('🔄 Mencoba UpscalePics API...');
        
        const form = new FormData();
        form.append('image', imageBuffer, {
            filename: 'enhance.jpg',
            contentType: 'image/jpeg'
        });
        form.append('scale', '2');
        
        const response = await axios.post(WORKING_APIS.upscalepics.url, form, {
            headers: {
                ...form.getHeaders(),
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
                'Accept': 'application/json'
            },
            timeout: 120000
        });
        
        if (response.data && response.data.result_url) {
            console.log('🔗 Downloading UpscalePics result...');
            
            const imageResponse = await axios.get(response.data.result_url, {
                responseType: 'arraybuffer',
                timeout: 60000
            });
            
            const resultBuffer = Buffer.from(imageResponse.data);
            
            if (resultBuffer.length > imageBuffer.length * 1.1) {
                console.log(`✅ UpscalePics berhasil: ${(resultBuffer.length / 1024 / 1024).toFixed(2)}MB`);
                return resultBuffer;
            }
        }
        
        throw new Error('UpscalePics: Response tidak valid atau tidak ada peningkatan');
        
    } catch (error) {
        console.error('❌ UpscalePics error:', error.message);
        throw error;
    }
}

/**
 * Fungsi untuk enhance dengan ClipDrop API (Fixed Implementation)
 */
async function enhanceWithClipDrop(imageBuffer, apiKey) {
    try {
        console.log('🔄 Mencoba ClipDrop API...');
        
        if (!apiKey || apiKey === 'YOUR_CLIPDROP_API_KEY') {
            throw new Error('ClipDrop API key tidak tersedia');
        }
        
        // Dapatkan metadata gambar untuk menentukan target size
        const sharp = require('sharp');
        const metadata = await sharp(imageBuffer).metadata();
        
        // Target size 2x dari original
        const targetWidth = Math.min(metadata.width * 2, 4096); // Max 4096px
        const targetHeight = Math.min(metadata.height * 2, 4096); // Max 4096px
        
        console.log(`📊 Original: ${metadata.width}x${metadata.height}, Target: ${targetWidth}x${targetHeight}`);
        
        const form = new FormData();
        form.append('image_file', imageBuffer, {
            filename: 'enhance.jpg',
            contentType: 'image/jpeg'
        });
        form.append('target_width', targetWidth.toString());
        form.append('target_height', targetHeight.toString());
        
        console.log('📤 Sending request to ClipDrop...');
        
        const response = await axios.post(WORKING_APIS.clipdrop.url, form, {
            headers: {
                ...form.getHeaders(),
                'x-api-key': apiKey,
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
            },
            timeout: 120000,
            responseType: 'arraybuffer',
            maxBodyLength: Infinity,
            maxContentLength: Infinity
        });
        
        console.log(`📥 ClipDrop response: ${response.status}`);
        console.log(`📊 Credits remaining: ${response.headers['x-remaining-credits'] || 'Unknown'}`);
        
        if (response.status === 200 && response.data) {
            const resultBuffer = Buffer.from(response.data);
            
            console.log(`✅ ClipDrop berhasil: ${(resultBuffer.length / 1024 / 1024).toFixed(2)}MB`);
            return resultBuffer;
        }
        
        throw new Error(`ClipDrop returned status ${response.status}`);
        
    } catch (error) {
        console.error('❌ ClipDrop error:', error.message);
        
        if (error.response) {
            console.error('❌ Response status:', error.response.status);
            console.error('❌ Response data:', error.response.data?.toString() || 'No response data');
            
            if (error.response.status === 400) {
                throw new Error('ClipDrop: Request format invalid (400)');
            } else if (error.response.status === 401) {
                throw new Error('ClipDrop: API key invalid (401)');
            } else if (error.response.status === 402) {
                throw new Error('ClipDrop: No credits remaining (402)');
            } else if (error.response.status === 429) {
                throw new Error('ClipDrop: Rate limit exceeded (429)');
            }
        }
        
        throw error;
    }
}

/**
 * Fungsi untuk enhance dengan Sharp (Local Processing) - Ultimate Fallback
 */
async function enhanceWithSharp(imageBuffer) {
    try {
        console.log('🔄 Menggunakan Sharp untuk local enhancement...');
        
        // Dapatkan metadata gambar asli
        const metadata = await sharp(imageBuffer).metadata();
        console.log(`📊 Original: ${metadata.width}x${metadata.height}`);
        
        // Upscale 2x dengan interpolasi dan sharpening
        const enhancedBuffer = await sharp(imageBuffer)
            .resize(metadata.width * 2, metadata.height * 2, {
                kernel: sharp.kernel.lanczos3, // High-quality interpolation
                fit: 'fill'
            })
            .sharpen(0.5, 1, 2) // Mild sharpening
            .modulate({
                brightness: 1.05, // Slight brightness boost
                saturation: 1.1   // Slight saturation boost
            })
            .jpeg({
                quality: 95,
                progressive: true,
                mozjpeg: true // Better compression
            })
            .toBuffer();
        
        console.log(`✅ Sharp enhancement selesai: ${(enhancedBuffer.length / 1024 / 1024).toFixed(2)}MB`);
        console.log(`📊 Upscaled to: ${metadata.width * 2}x${metadata.height * 2}`);
        
        return enhancedBuffer;
        
    } catch (error) {
        console.error('❌ Sharp enhancement error:', error.message);
        throw error;
    }
}

/**
 * Fungsi untuk enhance dengan Simple Bicubic (Jika Sharp tidak tersedia)
 */
async function enhanceWithSimpleBicubic(imageBuffer) {
    try {
        console.log('🔄 Menggunakan simple bicubic upscaling...');
        
        // Jika sharp tidak available, gunakan canvas processing sederhana
        // Ini adalah fallback terakhir yang pasti akan bekerja
        
        const Canvas = require('canvas');
        const Image = Canvas.Image;
        
        const img = new Image();
        img.src = imageBuffer;
        
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
        });
        
        const canvas = Canvas.createCanvas(img.width * 2, img.height * 2);
        const ctx = canvas.getContext('2d');
        
        // Set high-quality rendering
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        // Draw upscaled image
        ctx.drawImage(img, 0, 0, img.width * 2, img.height * 2);
        
        const enhancedBuffer = canvas.toBuffer('image/jpeg', { quality: 0.95 });
        
        console.log(`✅ Simple bicubic selesai: ${(enhancedBuffer.length / 1024 / 1024).toFixed(2)}MB`);
        return enhancedBuffer;
        
    } catch (error) {
        console.error('❌ Simple bicubic error:', error.message);
        throw error;
    }
}

/**
 * Fungsi untuk validasi gambar yang comprehensive
 */
function validateImageBuffer(buffer) {
    if (!buffer || buffer.length === 0) {
        throw new Error('Buffer gambar kosong atau tidak valid');
    }
    
    // Cek signature file
    const signatures = {
        jpeg: ['ffd8ff'],
        png: ['89504e47'],
        webp: ['52494646'],
        gif: ['47494638']
    };
    
    const fileHeader = buffer.slice(0, 8).toString('hex');
    let isValidFormat = false;
    let detectedFormat = 'unknown';
    
    for (const [format, sigs] of Object.entries(signatures)) {
        for (const sig of sigs) {
            if (fileHeader.startsWith(sig)) {
                isValidFormat = true;
                detectedFormat = format;
                break;
            }
        }
        if (isValidFormat) break;
    }
    
    if (!isValidFormat) {
        throw new Error(`Format file tidak didukung. Gunakan JPEG, PNG, WebP, atau GIF.`);
    }
    
    // Cek ukuran file (maksimal 20MB untuk processing)
    const maxSize = 20 * 1024 * 1024;
    if (buffer.length > maxSize) {
        throw new Error(`Ukuran file terlalu besar: ${(buffer.length / 1024 / 1024).toFixed(2)}MB (maksimal 20MB)`);
    }
    
    if (buffer.length < 1024) {
        throw new Error('File gambar terlalu kecil atau rusak');
    }
    
    console.log(`✅ Gambar valid: ${detectedFormat.toUpperCase()}, ${(buffer.length / 1024 / 1024).toFixed(2)}MB`);
    return { format: detectedFormat, size: buffer.length };
}

/**
 * Fungsi untuk cek koneksi internet
 */
async function checkInternetConnection() {
    const testUrls = [
        'https://google.com',
        'https://www.upscale.media',
        'https://httpbin.org/status/200'
    ];
    
    for (const url of testUrls) {
        try {
            const response = await axios.get(url, { 
                timeout: 8000,
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ConnTest/1.0)' }
            });
            
            if (response.status === 200) {
                console.log(`✅ Internet OK via ${url}`);
                return true;
            }
        } catch (error) {
            continue;
        }
    }
    
    return false;
}

/**
 * Fungsi untuk download media dengan retry
 */
async function downloadMediaWithRetry(quotedMessage, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`📥 Download attempt ${attempt}/${maxRetries}...`);
            
            const buffer = await downloadMediaMessage(quotedMessage, 'buffer', {});
            
            if (buffer && buffer.length > 0) {
                console.log(`✅ Download berhasil: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`);
                return buffer;
            } else {
                throw new Error('Downloaded buffer is empty');
            }
            
        } catch (error) {
            console.error(`❌ Download attempt ${attempt} failed:`, error.message);
            
            if (attempt === maxRetries) {
                throw new Error(`Download gagal setelah ${maxRetries} percobaan: ${error.message}`);
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
}

/**
 * Fungsi utama untuk enhance gambar dengan multiple fallbacks
 */
async function processImageEnhancement(imageBuffer, clipdropApiKey = null) {
    console.log('🎯 Memulai proses image enhancement...');
    
    // Validasi gambar
    validateImageBuffer(imageBuffer);
    
    // Sequence API calls dengan prioritas (hanya API yang benar-benar gratis/available)
    const enhancementMethods = [
        // ClipDrop jika ada API key
        ...(clipdropApiKey && clipdropApiKey !== 'YOUR_CLIPDROP_API_KEY' ? 
            [{ name: 'ClipDrop', func: () => enhanceWithClipDrop(imageBuffer, clipdropApiKey), requiresInternet: true }] : []
        ),
        // DeepAI dengan free demo key
        { name: 'DeepAI', func: () => enhanceWithDeepAI(imageBuffer), requiresInternet: true },
        // UpscalePics free API
        { name: 'UpscalePics', func: () => enhanceWithUpscalePics(imageBuffer), requiresInternet: true },
        // Local processing fallbacks
        { name: 'Sharp (Local)', func: () => enhanceWithSharp(imageBuffer), requiresInternet: false },
        { name: 'Simple Bicubic', func: () => enhanceWithSimpleBicubic(imageBuffer), requiresInternet: false }
    ];
    
    let lastError = null;
    let usedMethod = 'Unknown';
    
    for (const method of enhancementMethods) {
        try {
            console.log(`🚀 Mencoba ${method.name}...`);
            usedMethod = method.name;
            
            // Skip internet-based methods jika tidak ada koneksi
            if (method.requiresInternet) {
                const hasInternet = await checkInternetConnection();
                if (!hasInternet) {
                    console.log(`⚠️ Skip ${method.name} - no internet connection`);
                    continue;
                }
            }
            
            const result = await method.func();
            
            if (result && result.length > 0) {
                const sizeRatio = result.length / imageBuffer.length;
                
                // Untuk local processing, kita terima hasil apapun yang valid
                // Untuk online APIs, harus ada peningkatan minimal
                const isLocalMethod = !method.requiresInternet;
                const hasImprovement = isLocalMethod || sizeRatio > 1.1;
                
                if (hasImprovement) {
                    console.log(`✅ ${method.name} berhasil! Size ratio: ${sizeRatio.toFixed(2)}x`);
                    return { buffer: result, method: method.name, ratio: sizeRatio };
                } else {
                    console.log(`⚠️ ${method.name} tidak memberikan enhancement yang signifikan`);
                    continue;
                }
            }
            
        } catch (error) {
            console.log(`❌ ${method.name} gagal:`, error.message);
            lastError = error;
            continue;
        }
    }
    
    // Jika semua method gagal
    console.error('❌ Semua enhancement methods gagal');
    const errorDetails = lastError ? lastError.message : 'Unknown error';
    throw new Error(`Tidak dapat memproses gambar dengan method apapun. Last error: ${errorDetails}`);
}

module.exports = {
    name: "hd",
    alias: ["remini", "enhance", "upscale", "ai", "4k", "2x"],
    description: "Meningkatkan resolusi dan detail gambar menggunakan AI + Local Processing",
    category: "converter",
    cooldown: 30,
    execute: async (msg, { bot, usedPrefix, command }) => {
        const startTime = Date.now();
        let processingMessage = null;
        
        try {
            // Deteksi pesan gambar
            const quotedMessage = msg.quoted || msg;
            const messageType = quotedMessage?.type || quotedMessage?.mtype || "";
            
            console.log(`📋 Message type: ${messageType}`);
            
            if (!['imageMessage', 'image'].includes(messageType)) {
                const helpText = `❌ *Cara Penggunaan HD Enhancer:*\n\n` +
                    `📸 Kirim gambar + caption: \`${usedPrefix}${command}\`\n` +
                    `📸 Reply gambar dengan: \`${usedPrefix}${command}\`\n\n` +
                    `🎯 *Fitur:*\n` +
                    `• AI Enhancement (online)\n` +
                    `• Local Processing (offline)\n` +
                    `• 2x Upscaling\n` +
                    `• Smart Quality Enhancement\n\n` +
                    `📊 *Support:* JPEG, PNG, WebP, GIF (max 20MB)\n` +
                    `⏱️ *Waktu:* 15-90 detik`;
                
                return await msg.reply(helpText);
            }

            // Feedback awal
            await msg.react("⏳");
            
            processingMessage = await msg.reply(
                "🔄 *HD Enhancement dimulai...*\n\n" +
                "📊 Status: Mengunduh gambar...\n" +
                "🎯 Mode: AI + Local Processing\n" +
                "⏱️ Estimasi: 15-90 detik\n\n" +
                "_Processing dengan multiple fallback methods..._"
            );

            // Download gambar
            let imageBuffer;
            try {
                imageBuffer = await downloadMediaWithRetry(quotedMessage, 3);
            } catch (downloadError) {
                await msg.react("❌");
                return await msg.reply(
                    "❌ *Gagal mengunduh gambar*\n\n" +
                    `**Error:** ${downloadError.message}\n\n` +
                    "**Solusi:**\n" +
                    "• Kirim ulang gambar yang tidak rusak\n" +
                    "• Pastikan ukuran < 20MB\n" +
                    "• Coba dengan format JPEG/PNG"
                );
            }

            // Update status
            await msg.react("🧠");
            
            try {
                if (processingMessage?.key) {
                    await bot.sendMessage(msg.from, {
                        text: "🔄 *HD Enhancement berlangsung...*\n\n" +
                              "📊 Status: Memproses dengan AI...\n" +
                              "🎯 Progress: 60%\n" +
                              "⚡ Fallback: Local processing ready\n\n" +
                              "_Mohon tunggu, sedang enhance gambar..._",
                        edit: processingMessage.key
                    });
                }
            } catch (e) {
                // Ignore edit error
            }

            // Proses enhancement
            let enhancementResult;
            try {
                // Ambil ClipDrop API key dari environment atau hardcode
                const clipdropApiKey = process.env.CLIPDROP_API_KEY || 'YOUR_CLIPDROP_API_KEY';
                
                enhancementResult = await processImageEnhancement(imageBuffer, clipdropApiKey);
            } catch (enhanceError) {
                await msg.react("❌");
                
                const errorMsg = 
                    "❌ *Semua enhancement methods gagal*\n\n" +
                    `**Error:** ${enhanceError.message}\n\n` +
                    "**Kemungkinan penyebab:**\n" +
                    "• Semua AI service sedang down\n" +
                    "• ClipDrop API key tidak valid/expired\n" +
                    "• Gambar format tidak didukung\n" +
                    "• Sistem local processing error\n" +
                    "• Ukuran file terlalu besar\n\n" +
                    "**Solusi:**\n" +
                    "• Coba lagi dalam 10-15 menit\n" +
                    "• Periksa ClipDrop API key\n" +
                    "• Gunakan gambar JPEG/PNG < 10MB\n" +
                    "• Hubungi admin jika masalah berlanjut";
                
                return await msg.reply(errorMsg);
            }

            // Kirim hasil
            const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
            const originalSizeMB = (imageBuffer.length / 1024 / 1024).toFixed(2);
            const resultSizeMB = (enhancementResult.buffer.length / 1024 / 1024).toFixed(2);
            const sizeRatio = enhancementResult.ratio.toFixed(2);
            
            const successCaption = 
                `✅ *Gambar berhasil di-enhance!*\n\n` +
                `📊 **Enhancement Details:**\n` +
                `• Ukuran asli: ${originalSizeMB} MB\n` +
                `• Ukuran hasil: ${resultSizeMB} MB\n` +
                `• Size ratio: ${sizeRatio}x\n` +
                `• Waktu proses: ${processingTime}s\n` +
                `• Method: ${enhancementResult.method}\n` +
                `• Engine: ${enhancementResult.method.includes('ClipDrop') ? 'AI (Paid)' : 
                           enhancementResult.method.includes('DeepAI') ? 'AI (Free)' : 
                           enhancementResult.method.includes('UpscalePics') ? 'AI (Free)' : 'Local Processing'}\n\n` +
                `🎯 *Resolusi dan kualitas telah ditingkatkan*\n` +
                `💡 *Method used: ${enhancementResult.method}*`;

            await bot.sendMessage(msg.from, {
                image: enhancementResult.buffer,
                caption: successCaption,
                mimetype: 'image/jpeg'
            }, { quoted: msg });

            await msg.react("✅");
            
            // Cleanup
            try {
                if (processingMessage?.key) {
                    await bot.sendMessage(msg.from, { delete: processingMessage.key });
                }
            } catch (e) {
                // Ignore
            }

            console.log(`✅ HD processing completed in ${processingTime}s with ratio ${sizeRatio}x`);

        } catch (error) {
            console.error("❌ Fatal error in HD command:", error);
            await msg.react("❌");
            
            await msg.reply(
                "❌ *System Error*\n\n" +
                "Terjadi kesalahan fatal pada sistem.\n" +
                "Mohon coba lagi atau hubungi admin.\n\n" +
                `**Error:** ${error.message}`
            );
        }
    }
};