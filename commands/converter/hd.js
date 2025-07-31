const axios = require('axios');
const FormData = require('form-data');
const { downloadMediaMessage } = require('lily-baileys');

/**
 * Fungsi untuk meningkatkan kualitas gambar menggunakan API Revesery.
 * Ini adalah satu-satunya metode yang akan kita gunakan karena terbukti stabil.
 * @param {Buffer} imageBuffer - Buffer dari gambar yang akan diproses.
 * @returns {Promise<Buffer>} Buffer dari gambar yang sudah ditingkatkan kualitasnya.
 */
async function enhanceWithRevesery(imageBuffer) {
    return new Promise(async (resolve, reject) => {
        try {
            const form = new FormData();
            form.append('file', imageBuffer, {
                filename: 'remini.jpg',
                contentType: 'image/jpeg'
            });

            // Memanggil API dari Revesery
            const { data } = await axios.post(
                'https://tools.revesery.com/remini/remini.php',
                form, {
                    headers: {
                        ...form.getHeaders(),
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36'
                    },
                    responseType: 'json', // API ini mengembalikan JSON
                    timeout: 120000 // Timeout 2 menit untuk jaga-jaga
                }
            );

            // Cek apakah response berisi URL hasil
            if (data && data.url_result) {
                // Jika ya, unduh gambar dari URL tersebut
                const imageResponse = await axios.get(data.url_result, {
                    responseType: 'arraybuffer'
                });
                resolve(Buffer.from(imageResponse.data));
            } else {
                throw new Error('Respons tidak valid dari Revesery API');
            }
        } catch (e) {
            console.error('Revesery API Error:', e.message);
            reject(new Error('Gagal saat menghubungi Revesery API'));
        }
    });
}

/**
 * Fungsi untuk memeriksa koneksi internet.
 * @returns {Promise<boolean>} True jika terhubung, false jika tidak.
 */
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
    description: "Meningkatkan resolusi dan detail gambar menggunakan AI.",
    category: "converter",
    execute: async (msg, { bot, usedPrefix, command }) => {
        try {
            const quotedMessage = msg.quoted ? msg.quoted : msg;
            const messageType = quotedMessage.type || "";
            
            if (messageType !== 'imageMessage') {
                return msg.reply(`Kirim atau balas gambar dengan caption \`${usedPrefix + command}\` untuk meningkatkan kualitasnya.`);
            }

            // Cek koneksi internet terlebih dahulu
            const isConnected = await checkConnection();
            if (!isConnected) {
                return msg.reply("❌ Tidak ada koneksi internet. Mohon periksa kembali koneksi Anda.");
            }

            await msg.react("🧠"); // Reaksi "berpikir"
            await msg.reply("🔄 Sedang memproses gambar... Mohon tunggu sebentar, ini mungkin akan memakan waktu...");

            // Download gambar
            const imageBuffer = await downloadMediaMessage(
                quotedMessage,
                'buffer',
                {}
            );

            if (!imageBuffer || imageBuffer.length === 0) {
                await msg.react("❌");
                return msg.reply("❌ Gagal mengunduh gambar. Coba kirim ulang gambar Anda.");
            }

            // Cek ukuran file (maksimal 5MB)
            if (imageBuffer.length > 5 * 1024 * 1024) {
                await msg.react("❌");
                return msg.reply("❌ Ukuran gambar yang Anda kirim terlalu besar (maksimal 5MB).");
            }

            console.log(`Memproses gambar dengan ukuran: ${(imageBuffer.length / 1024 / 1024).toFixed(2)}MB`);

            // Langsung gunakan fungsi enhance dari Revesery
            const processedImage = await enhanceWithRevesery(imageBuffer);

            if (!processedImage || processedImage.length === 0) {
                await msg.react("❌");
                return msg.reply("❌ Gagal memproses gambar. Hasil yang diterima kosong.");
            }

            // Kirim gambar hasil
            await bot.sendMessage(msg.from, { 
                image: processedImage,
                caption: `✅ Gambar berhasil ditingkatkan dengan AI!\n📊 Ukuran hasil: ${(processedImage.length / 1024 / 1024).toFixed(2)}MB`,
                mimetype: 'image/jpeg'
            }, { quoted: msg });

            await msg.react("✅");

        } catch (error) {
            console.error("Error pada perintah HD:", error);
            await msg.react("❌");
            
            let errorMessage = "❌ Terjadi kesalahan saat memproses gambar.";
            
            if (error.message.includes('ECONNREFUSED')) {
                errorMessage = "❌ Tidak dapat terhubung ke server AI. Kemungkinan server sedang down atau ada masalah jaringan.";
            } else if (error.message.includes('timeout')) {
                errorMessage = "❌ Waktu pemrosesan habis (timeout). Coba lagi dengan gambar yang ukurannya lebih kecil.";
            }
            
            msg.reply(errorMessage);
        }
    },
};