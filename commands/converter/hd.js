const axios = require('axios');
const FormData = require('form-data');
const { downloadMediaMessage } = require('lily-baileys');

/**
 * Multiple API endpoints untuk enhance gambar
 */
const ENHANCE_APIS = {
    waifu2x_org: {
        url: 'https://waifu2x.org/api',
        method: 'waifu2x_org'
    },
    waifu2x_net: {
        url: 'https://waifu2x.net/api/v1/upscale',
        method: 'waifu2x_net'
    },
    revesery: {
        url: 'https://tools.revesery.com/remini/remini.php',
        method: 'revesery'
    }
};

/**
 * Fungsi untuk enhance gambar menggunakan Revesery API (Improved)
 */
async function enhanceWithRevesery(imageBuffer) {
    return new Promise(async (resolve, reject) => {
        try {
            console.log('🔄 Memproses dengan Revesery API...');
            
            const form = new FormData();
            form.append('file', imageBuffer, {
                filename: 'enhance_image.jpg',
                contentType: 'image/jpeg'
            });

            // Headers yang lebih lengkap dan sesuai dengan browser real
            const headers = {
                ...form.getHeaders(),
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Origin': 'https://tools.revesery.com',
                'Referer': 'https://tools.revesery.com/',
                'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Linux"',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin'
            };

            console.log('📤 Mengirim request ke Revesery...');

            const response = await axios.post(ENHANCE_APIS.revesery.url, form, {
                headers: headers,
                timeout: 180000, // 3 menit
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
                validateStatus: function (status) {
                    return status < 500; // Accept semua status code < 500
                }
            });

            console.log('📥 Response status:', response.status);
            console.log('📥 Response data:', response.data);

            if (response.status !== 200) {
                throw new Error(`HTTP Error: ${response.status} - ${response.statusText}`);
            }

            // Handle berbagai format response
            let result = response.data;
            if (typeof result === 'string') {
                try {
                    result = JSON.parse(result);
                } catch (e) {
                    console.log('Response bukan JSON, mencoba sebagai URL langsung...');
                    if (result.includes('http')) {
                        result = { url_result: result.trim() };
                    }
                }
            }

            if (result && (result.url_result || result.result || result.enhanced_url)) {
                const imageUrl = result.url_result || result.result || result.enhanced_url;
                console.log('🔗 Mengunduh gambar hasil dari:', imageUrl);
                
                const imageResponse = await axios.get(imageUrl, {
                    responseType: 'arraybuffer',
                    timeout: 120000, // 2 menit untuk download
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
                        'Referer': 'https://tools.revesery.com/'
                    }
                });

                if (imageResponse.status !== 200) {
                    throw new Error(`Gagal download gambar hasil: ${imageResponse.status}`);
                }

                const resultBuffer = Buffer.from(imageResponse.data);
                
                if (resultBuffer.length === 0) {
                    throw new Error('Buffer hasil kosong');
                }

                console.log(`✅ Berhasil! Ukuran hasil: ${(resultBuffer.length / 1024 / 1024).toFixed(2)}MB`);
                resolve(resultBuffer);
                
            } else {
                console.error('Response tidak valid:', result);
                throw new Error('Response API tidak mengandung URL hasil yang valid');
            }

        } catch (error) {
            console.error('❌ Error Revesery API:', error.message);
            
            if (error.code === 'ECONNABORTED') {
                reject(new Error('Timeout: Proses terlalu lama, coba dengan gambar yang lebih kecil'));
            } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
                reject(new Error('Tidak dapat terhubung ke server enhancement'));
            } else {
                reject(new Error(`Gagal memproses gambar: ${error.message}`));
            }
        }
    });
}

/**
 * Fungsi untuk enhance dengan Waifu2x.org API
 */
async function enhanceWithWaifu2xOrg(imageBuffer) {
    return new Promise(async (resolve, reject) => {
        try {
            console.log('🔄 Mencoba Waifu2x.org API...');
            
            const form = new FormData();
            form.append('file', imageBuffer, {
                filename: 'enhance.jpg',
                contentType: 'image/jpeg'
            });
            form.append('scale', '2'); // 2x upscale
            form.append('noise', '1'); // noise reduction level
            
            const response = await axios.post('https://waifu2x.org/api', form, {
                headers: {
                    ...form.getHeaders(),
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
                    'Accept': 'application/json',
                    'Referer': 'https://waifu2x.org/'
                },
                timeout: 120000
            });
            
            if (response.data && response.data.url) {
                const imageResponse = await axios.get(response.data.url, {
                    responseType: 'arraybuffer',
                    timeout: 60000
                });
                
                const resultBuffer = Buffer.from(imageResponse.data);
                console.log(`✅ Waifu2x.org berhasil: ${(resultBuffer.length / 1024 / 1024).toFixed(2)}MB`);
                resolve(resultBuffer);
            } else {
                throw new Error('Waifu2x.org response tidak valid');
            }
            
        } catch (error) {
            console.error('❌ Error Waifu2x.org:', error.message);
            reject(error);
        }
    });
}

/**
 * Fungsi untuk enhance dengan API alternatif menggunakan upscaling sederhana
 */
async function enhanceWithSimpleUpscale(imageBuffer) {
    return new Promise(async (resolve, reject) => {
        try {
            console.log('🔄 Menggunakan simple upscale fallback...');
            
            // Coba menggunakan API publik lain yang available
            const form = new FormData();
            form.append('image', imageBuffer, {
                filename: 'image.jpg',
                contentType: 'image/jpeg'
            });
            
            // Coba API waifu2x publik yang lain
            const publicApis = [
                'https://api.waifu2x.cc/upscale',
                'https://waifu2x.pro/api/upscale'
            ];
            
            for (const apiUrl of publicApis) {
                try {
                    console.log(`📡 Trying ${apiUrl}...`);
                    
                    const response = await axios.post(apiUrl, form, {
                        headers: {
                            ...form.getHeaders(),
                            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
                        },
                        timeout: 90000
                    });
                    
                    if (response.data && (response.data.url || response.data.result_url)) {
                        const imageUrl = response.data.url || response.data.result_url;
                        const imageResponse = await axios.get(imageUrl, {
                            responseType: 'arraybuffer',
                            timeout: 60000
                        });
                        
                        const resultBuffer = Buffer.from(imageResponse.data);
                        
                        // Cek apakah hasilnya benar-benar berbeda (minimal 10% lebih besar)
                        if (resultBuffer.length > imageBuffer.length * 1.1) {
                            console.log(`✅ Enhancement berhasil via ${apiUrl}: ${(resultBuffer.length / 1024 / 1024).toFixed(2)}MB`);
                            resolve(resultBuffer);
                            return;
                        }
                    }
                } catch (apiError) {
                    console.log(`❌ ${apiUrl} failed:`, apiError.message);
                    continue;
                }
            }
            
            // Jika semua API gagal, return error instead of original image
            throw new Error('Semua API enhancement tidak tersedia atau tidak memberikan hasil yang valid');
            
        } catch (error) {
            console.error('❌ Error Simple Upscale:', error.message);
            reject(error);
        }
    });
}

/**
 * Fungsi untuk validasi gambar yang lebih robust
 */
function validateImageBuffer(buffer) {
    if (!buffer || buffer.length === 0) {
        throw new Error('Buffer gambar kosong atau tidak valid');
    }
    
    // Cek signature file untuk format yang didukung
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
        throw new Error(`Format file tidak didukung. Terdeteksi: ${detectedFormat}. Gunakan JPEG, PNG, WebP, atau GIF.`);
    }
    
    // Cek ukuran file (maksimal 15MB untuk lily-baileys)
    const maxSize = 15 * 1024 * 1024; // 15MB
    if (buffer.length > maxSize) {
        throw new Error(`Ukuran file terlalu besar: ${(buffer.length / 1024 / 1024).toFixed(2)}MB (maksimal 15MB)`);
    }
    
    // Cek ukuran minimum (minimal 1KB)
    if (buffer.length < 1024) {
        throw new Error('File gambar terlalu kecil atau rusak');
    }
    
    console.log(`✅ Gambar valid: ${detectedFormat.toUpperCase()}, ${(buffer.length / 1024 / 1024).toFixed(2)}MB`);
    return { format: detectedFormat, size: buffer.length };
}

/**
 * Fungsi untuk cek koneksi dengan multiple endpoints
 */
async function checkConnectivity() {
    const testUrls = [
        'https://google.com',
        'https://tools.revesery.com',
        'https://httpbin.org/status/200'
    ];
    
    for (const url of testUrls) {
        try {
            const response = await axios.get(url, { 
                timeout: 8000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; ConnTest/1.0)'
                }
            });
            
            if (response.status === 200) {
                console.log(`✅ Koneksi OK via ${url}`);
                return true;
            }
        } catch (error) {
            console.log(`❌ Gagal connect ke ${url}:`, error.message);
            continue;
        }
    }
    
    return false;
}

/**
 * Fungsi untuk download media dengan retry mechanism
 */
async function downloadMediaWithRetry(quotedMessage, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`📥 Percobaan download ${attempt}/${maxRetries}...`);
            
            const buffer = await downloadMediaMessage(
                quotedMessage,
                'buffer',
                {}
            );
            
            if (buffer && buffer.length > 0) {
                console.log(`✅ Download berhasil: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`);
                return buffer;
            } else {
                throw new Error('Buffer hasil download kosong');
            }
            
        } catch (error) {
            console.error(`❌ Download attempt ${attempt} gagal:`, error.message);
            
            if (attempt === maxRetries) {
                throw new Error(`Gagal download media setelah ${maxRetries} percobaan: ${error.message}`);
            }
            
            // Delay sebelum retry
            const delay = 1000 * attempt; // 1s, 2s, 3s
            console.log(`⏳ Menunggu ${delay}ms sebelum retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Fungsi utama untuk enhance gambar dengan multiple API fallback
 */
async function processImageEnhancement(imageBuffer) {
    console.log('🎯 Memulai proses enhancement...');
    
    // Validasi gambar
    const validation = validateImageBuffer(imageBuffer);
    
    // Priority order API calls
    const apiSequence = [
        { name: 'Waifu2x.org', func: enhanceWithWaifu2xOrg },
        { name: 'Simple Upscale', func: enhanceWithSimpleUpscale },
        { name: 'Revesery', func: enhanceWithRevesery }
    ];
    
    let lastError = null;
    
    for (const api of apiSequence) {
        try {
            console.log(`🚀 Mencoba ${api.name}...`);
            const result = await api.func(imageBuffer);
            
            // Validasi hasil - pastikan benar-benar ada enhancement
            if (result && result.length > 0) {
                const sizeDifference = Math.abs(result.length - imageBuffer.length);
                const sizeRatio = result.length / imageBuffer.length;
                
                // Cek apakah ada perubahan signifikan (minimal 5% difference atau 1.2x size)
                if (sizeDifference > (imageBuffer.length * 0.05) || sizeRatio > 1.2 || sizeRatio < 0.8) {
                    console.log(`✅ ${api.name} berhasil! Size ratio: ${sizeRatio.toFixed(2)}x`);
                    return result;
                } else {
                    console.log(`⚠️ ${api.name} tidak memberikan enhancement yang signifikan`);
                    lastError = new Error(`${api.name}: Tidak ada peningkatan kualitas yang terdeteksi`);
                    continue;
                }
            }
            
        } catch (error) {
            console.log(`❌ ${api.name} gagal:`, error.message);
            lastError = error;
            continue;
        }
    }
    
    // Jika semua API gagal, throw error instead of returning original
    console.error('❌ Semua API enhancement gagal');
    throw lastError || new Error('Semua service enhancement tidak tersedia atau tidak memberikan hasil yang valid');
}

module.exports = {
    name: "hd",
    alias: ["remini", "enhance", "upscale", "ai", "4k"],
    description: "Meningkatkan resolusi dan detail gambar menggunakan AI",
    category: "converter",
    cooldown: 30,
    execute: async (msg, { bot, usedPrefix, command }) => {
        const startTime = Date.now();
        let processingMessage = null;
        
        try {
            // Identifikasi pesan yang mengandung gambar
            const quotedMessage = msg.quoted || msg;
            const messageType = quotedMessage?.type || quotedMessage?.mtype || "";
            
            console.log(`📋 Detecting message type: ${messageType}`);
            
            // Validasi tipe pesan
            const validTypes = ['imageMessage', 'image'];
            if (!validTypes.includes(messageType)) {
                const helpText = `❌ *Cara Penggunaan:*\n\n` +
                    `📸 Kirim gambar + caption: \`${usedPrefix}${command}\`\n` +
                    `📸 Reply gambar dengan: \`${usedPrefix}${command}\`\n\n` +
                    `🎯 *Fitur:* Meningkatkan kualitas & resolusi gambar dengan AI\n` +
                    `📊 *Format:* JPEG, PNG, WebP, GIF (max 15MB)\n` +
                    `⏱️ *Estimasi:* 30-90 detik`;
                
                return await msg.reply(helpText);
            }

            // Cek koneksi internet
            console.log('🌐 Memeriksa koneksi internet...');
            const isOnline = await checkConnectivity();
            if (!isOnline) {
                return await msg.reply(
                    "❌ *Tidak ada koneksi internet*\n\n" +
                    "🔧 *Solusi:*\n" +
                    "• Periksa koneksi internet server\n" +
                    "• Coba lagi dalam beberapa menit\n" +
                    "• Hubungi admin jika masalah berlanjut"
                );
            }

            // Feedback awal
            await msg.react("⏳");
            
            processingMessage = await msg.reply(
                "🔄 *Memproses gambar dengan AI...*\n\n" +
                "📊 Status: Mengunduh gambar...\n" +
                "⏱️ Estimasi: 30-90 detik\n" +
                "🎯 Mode: HD Enhancement\n\n" +
                "_Mohon tunggu, jangan kirim perintah lain..._"
            );

            // Download gambar dengan retry
            let imageBuffer;
            try {
                imageBuffer = await downloadMediaWithRetry(quotedMessage, 3);
            } catch (downloadError) {
                await msg.react("❌");
                return await msg.reply(
                    "❌ *Gagal mengunduh gambar*\n\n" +
                    `🔧 **Error:** ${downloadError.message}\n\n` +
                    "**Solusi:**\n" +
                    "• Coba kirim ulang gambar\n" +
                    "• Pastikan gambar tidak rusak\n" +
                    "• Gunakan gambar dengan ukuran lebih kecil"
                );
            }

            // Update status
            await msg.react("🧠");
            
            try {
                // Edit pesan status jika memungkinkan
                if (processingMessage?.key) {
                    await bot.sendMessage(msg.from, {
                        text: "🔄 *Memproses gambar dengan AI...*\n\n" +
                              "📊 Status: Meningkatkan kualitas...\n" +
                              "⏱️ Progress: 50%\n" +
                              "🎯 Mode: HD Enhancement\n\n" +
                              "_Sedang memproses dengan server AI..._",
                        edit: processingMessage.key
                    });
                }
            } catch (e) {
                // Ignore edit error
            }

            // Proses enhancement
            let enhancedBuffer;
            try {
                enhancedBuffer = await processImageEnhancement(imageBuffer);
            } catch (enhanceError) {
                await msg.react("❌");
                
                let errorMsg = "❌ *Gagal memproses gambar*\n\n";
                
                if (enhanceError.message.includes('terlalu besar')) {
                    errorMsg += "📏 **Masalah:** Ukuran file terlalu besar\n";
                    errorMsg += "🔧 **Solusi:** Kompres gambar hingga < 15MB";
                } else if (enhanceError.message.includes('format')) {
                    errorMsg += "📷 **Masalah:** Format tidak didukung\n";
                    errorMsg += "🔧 **Solusi:** Gunakan JPEG, PNG, WebP, atau GIF";
                } else if (enhanceError.message.includes('Timeout')) {
                    errorMsg += "⏱️ **Masalah:** Proses timeout\n";
                    errorMsg += "🔧 **Solusi:** Coba dengan gambar lebih kecil";
                } else if (enhanceError.message.includes('server') || enhanceError.message.includes('connect')) {
                    errorMsg += "🌐 **Masalah:** Server AI tidak dapat diakses\n";
                    errorMsg += "🔧 **Solusi:** Coba lagi dalam 5-10 menit";
                } else {
                    errorMsg += `🔧 **Error:** ${enhanceError.message}\n\n`;
                    errorMsg += "**Coba lagi atau hubungi admin**";
                }
                
                return await msg.reply(errorMsg);
            }

            // Kirim hasil
            const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
            const originalSizeMB = (imageBuffer.length / 1024 / 1024).toFixed(2);
            const resultSizeMB = (enhancedBuffer.length / 1024 / 1024).toFixed(2);
            
            const successCaption = 
                `✅ *Gambar berhasil ditingkatkan!*\n\n` +
                `📊 **Detail Processing:**\n` +
                `• Ukuran asli: ${originalSizeMB} MB\n` +
                `• Ukuran hasil: ${resultSizeMB} MB\n` +
                `• Waktu proses: ${processingTime}s\n` +
                `• Engine: AI Enhancement\n` +
                `• Quality: HD Upscaled\n\n` +
                `🎯 *Kualitas dan resolusi telah ditingkatkan dengan AI*\n` +
                `💡 *Tip: Simpan gambar untuk hasil terbaik*`;

            await bot.sendMessage(msg.from, {
                image: enhancedBuffer,
                caption: successCaption,
                mimetype: 'image/jpeg'
            }, { quoted: msg });

            await msg.react("✅");
            
            // Hapus pesan processing jika ada
            try {
                if (processingMessage?.key) {
                    await bot.sendMessage(msg.from, { delete: processingMessage.key });
                }
            } catch (e) {
                // Ignore delete error
            }

            console.log(`✅ HD processing completed in ${processingTime}s`);

        } catch (error) {
            console.error("❌ Fatal error in HD command:", error);
            await msg.react("❌");
            
            const fatalErrorMsg = 
                "❌ *Terjadi kesalahan sistem*\n\n" +
                "🔧 **Solusi:**\n" +
                "• Restart bot jika perlu\n" +
                "• Coba lagi dalam beberapa menit\n" +
                "• Hubungi admin jika error berlanjut\n\n" +
                `**Error Code:** ${error.message}`;
            
            await msg.reply(fatalErrorMsg);
        }
    }
};