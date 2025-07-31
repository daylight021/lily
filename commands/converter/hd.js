const axios = require('axios');
const FormData = require('form-data');
const { downloadMediaMessage } = require('lily-baileys');

async function reminiVyro(imageBuffer, method = 'enhance') {
    return new Promise(async (resolve, reject) => {
        try {
            const form = new FormData();
            form.append('image', imageBuffer, {
                filename: 'enhance_image.jpg',
                contentType: 'image/jpeg'
            });
            form.append('model_version', 1);

            const { data } = await axios.post(
                `https://inferenceengine.vyro.ai/${method}`,
                form, {
                    headers: {
                        ...form.getHeaders(),
                        'Accept': 'image/jpeg',
                        'User-Agent': 'Remini/2.0.0 (Android)',
                        'Connection': 'keep-alive',
                    },
                    responseType: 'arraybuffer',
                    timeout: 60000, // 60 detik timeout
                }
            );
            resolve(Buffer.from(data));
        } catch (e) {
            console.error('Vyro API Error:', e.message);
            reject(new Error('Vyro.ai API failed'));
        }
    });
}

// Fungsi alternatif menggunakan API Waifu2x
async function enhanceWithWaifu2x(imageBuffer) {
    return new Promise(async (resolve, reject) => {
        try {
            const form = new FormData();
            form.append('file', imageBuffer, {
                filename: 'image.jpg',
                contentType: 'image/jpeg'
            });

            const { data } = await axios.post(
                'https://api.waifu2x.booru.pics/api',
                form, {
                    headers: {
                        ...form.getHeaders(),
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36'
                    },
                    responseType: 'arraybuffer',
                    timeout: 120000
                }
            );
            resolve(Buffer.from(data));
        } catch (e) {
            console.error('Waifu2x API Error:', e.message);
            reject(new Error('Waifu2x API failed'));
        }
    });
}

// Fungsi untuk enhance menggunakan API Real-ESRGAN (DeepAI)
async function enhanceWithRealESRGAN(imageBuffer) {
    return new Promise(async (resolve, reject) => {
        try {
            const form = new FormData();
            form.append('image', imageBuffer, {
                filename: 'input.jpg',
                contentType: 'image/jpeg'
            });

            const { data } = await axios.post(
                'https://api.deepai.org/api/torch-srgan', // Menggunakan model alternatif yang stabil
                form, {
                    headers: {
                        ...form.getHeaders(),
                        'api-key': 'e72b5aa0-acc3-48b5-b4c5-54be052d29dd'
                    },
                    timeout: 120000
                }
            );

            if (data && data.output_url) {
                const imageResponse = await axios.get(data.output_url, {
                    responseType: 'arraybuffer',
                    timeout: 30000
                });
                resolve(Buffer.from(imageResponse.data));
            } else {
                throw new Error('Invalid response from DeepAI API');
            }
        } catch (e) {
            console.error('DeepAI API Error:', e.message);
            reject(new Error('DeepAI API failed'));
        }
    });
}


// Fungsi utama dengan sistem fallback yang sudah diperbaiki
async function enhanceImage(imageBuffer) {
    // Daftar metode API yang akan dicoba secara berurutan
    const methods = [
        { name: 'Vyro.ai (Remini)', func: () => reminiVyro(imageBuffer) },
        { name: 'Waifu2x', func: () => enhanceWithWaifu2x(imageBuffer) },
        { name: 'Real-ESRGAN (API)', func: () => enhanceWithRealESRGAN(imageBuffer) } // Aktifkan jika Anda punya API key DeepAI
    ];

    for (let i = 0; i < methods.length; i++) {
        try {
            console.log(`Mencoba enhance dengan ${methods[i].name}...`);
            const result = await methods[i].func();
            console.log(`✅ Berhasil enhance dengan ${methods[i].name}`);
            return result;
        } catch (error) {
            console.log(`❌ Gagal enhance dengan ${methods[i].name}: ${error.message}`);
            if (i === methods.length - 1) {
                throw new Error('Semua API gagal, coba lagi nanti.');
            }
        }
    }
}

// Fungsi untuk cek koneksi internet
async function checkConnection() {
    try {
        await axios.get('https://google.com', { timeout: 5000 });
        return true;
    } catch (error) {
        return false;
    }
}

module.exports = {
    name: "hd",
    alias: ["remini", "enhance", "upscale"],
    description: "Meningkatkan resolusi dan detail gambar menggunakan AI dengan multiple fallback APIs.",
    category: "converter",
    execute: async (msg, { bot, usedPrefix, command }) => {
        try {
            const quotedMessage = msg.quoted ? msg.quoted : msg;
            const messageType = quotedMessage.type || "";

            if (messageType !== 'imageMessage') {
                return msg.reply(`Kirim atau balas gambar dengan caption \`${usedPrefix + command}\` untuk meningkatkan kualitasnya.`);
            }

            const isConnected = await checkConnection();
            if (!isConnected) {
                return msg.reply("❌ Tidak ada koneksi internet. Periksa koneksi Anda.");
            }

            await msg.react("🧠");
            await msg.reply("🔄 Sedang memproses gambar, ini mungkin memakan waktu sebentar...");

            const imageBuffer = await downloadMediaMessage(
                quotedMessage,
                'buffer',
                {}
            );

            if (!imageBuffer || imageBuffer.length === 0) {
                await msg.react("❌");
                return msg.reply("❌ Gagal mengunduh gambar. Coba kirim ulang.");
            }

            if (imageBuffer.length > 5 * 1024 * 1024) {
                await msg.react("❌");
                return msg.reply("❌ Ukuran gambar terlalu besar (maksimal 5MB).");
            }

            const processedImage = await enhanceImage(imageBuffer);

            if (!processedImage || processedImage.length === 0) {
                await msg.react("❌");
                return msg.reply("❌ Gagal memproses gambar. Hasil kosong.");
            }

            await bot.sendMessage(msg.from, {
                image: processedImage,
                caption: `✅ Gambar berhasil ditingkatkan!\n📊 Ukuran hasil: ${(processedImage.length / 1024 / 1024).toFixed(2)}MB`,
                mimetype: 'image/jpeg'
            }, { quoted: msg });

            await msg.react("✅");

        } catch (error) {
            console.error("Error pada perintah HD:", error);
            await msg.react("❌");
            
            let errorMessage = "❌ Terjadi kesalahan saat memproses gambar.";
            if (error.message.includes('Semua API gagal')) {
                errorMessage = "❌ Semua server AI sedang sibuk atau bermasalah. Coba lagi dalam beberapa menit.";
            }
            
            msg.reply(errorMessage);
        }
    },
};