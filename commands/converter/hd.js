const { downloadMediaMessage } = require('lily-baileys');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

/**
 * @param {Buffer} imageBuffer Buffer dari gambar yang akan diproses.
 * @returns {Promise<Buffer>} Buffer dari gambar yang sudah ditingkatkan kualitasnya.
 */
async function enhanceWithSharp(imageBuffer) {
    try {
        console.log('🔄 Memulai proses enhancement lokal dengan Sharp...');
        
        const metadata = await sharp(imageBuffer).metadata();
        console.log(`📊 Ukuran Asli: ${metadata.width}x${metadata.height}`);
        
        // Target upscale 2x dari resolusi asli
        const targetWidth = metadata.width * 2;
        const targetHeight = metadata.height * 2;
        console.log(`🎯 Ukuran Target: ${targetWidth}x${targetHeight}`);

        const enhancedBuffer = await sharp(imageBuffer)
            .resize(targetWidth, targetHeight, {
                kernel: sharp.kernel.lanczos3, 
                fit: 'contain'
            })
            .sharpen({ 
                sigma: 0.5,
                m1: 1,
                m2: 2
            }) 
            .modulate({ 
                brightness: 1.05,
                saturation: 1.1
            })
            .jpeg({
                quality: 95,   
                progressive: true,
                mozjpeg: true    
            })
            .toBuffer();
        
        console.log(`✅ Proses Sharp selesai. Ukuran baru: ${(enhancedBuffer.length / 1024 / 1024).toFixed(2)}MB`);
        
        return enhancedBuffer;
        
    } catch (error) {
        console.error('❌ Terjadi error pada Sharp:', error.message);
        throw new Error('Gagal memproses gambar secara lokal dengan Sharp.');
    }
}

/**
 * Fungsi untuk validasi buffer gambar.
 */
function validateImageBuffer(buffer) {
    if (!buffer || buffer.length < 1024) { // Cek jika buffer kosong atau terlalu kecil
        throw new Error('Buffer gambar tidak valid, rusak, atau terlalu kecil.');
    }
    
    const fileHeader = buffer.slice(0, 8).toString('hex');
    const isJPEG = fileHeader.startsWith('ffd8ff');
    const isPNG = fileHeader.startsWith('89504e47');
    
    if (!isJPEG && !isPNG) {
        throw new Error('Format file tidak didukung. Harap gunakan gambar JPEG atau PNG.');
    }

    const maxSize = 20 * 1024 * 1024; // Maksimal 20MB
    if (buffer.length > maxSize) {
        throw new Error(`Ukuran file terlalu besar: ${(buffer.length / 1024 / 1024).toFixed(2)}MB (maksimal 20MB)`);
    }

    console.log(`✅ Gambar valid, ukuran: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`);
    return true;
}


module.exports = {
    name: "hd",
    alias: ["remini", "enhance", "upscale", "4k"],
    description: "Meningkatkan resolusi dan detail gambar ke kualitas HD secara lokal.",
    category: "converter",
    cooldown: 20, // Cooldown bisa dikurangi karena prosesnya lokal
    execute: async (msg, { bot, usedPrefix, command }) => {
        const startTime = Date.now();
        
        try {
            const quotedMessage = msg.quoted || msg;
            const messageType = quotedMessage?.type || quotedMessage?.mtype || "";
            
            if (!['imageMessage', 'image'].includes(messageType)) {
                return await msg.reply(
                    `❌ *Gagal Memproses*\n\nKirim atau balas gambar dengan caption \`${usedPrefix}${command}\` untuk meningkatkan kualitasnya menjadi HD.`
                );
            }

            await msg.react("⏳");
            const processingMessage = await msg.reply("✨ Sedang mengubah gambar menjadi HD... Mohon tunggu sebentar!");

            // Download gambar
            let imageBuffer;
            try {
                imageBuffer = await downloadMediaMessage(quotedMessage, 'buffer', {});
            } catch (downloadError) {
                await msg.react("❌");
                return await msg.reply(`❌ *Gagal mengunduh gambar.*\n\n**Error:** ${downloadError.message}`);
            }

            // Validasi gambar sebelum diproses
            validateImageBuffer(imageBuffer);

            await msg.react("⚙️");
            
            // Proses enhancement hanya dengan Sharp
            const enhancedBuffer = await enhanceWithSharp(imageBuffer);
            
            const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
            const originalSizeMB = (imageBuffer.length / 1024 / 1024).toFixed(2);
            const resultSizeMB = (enhancedBuffer.length / 1024 / 1024).toFixed(2);

            const successCaption = 
                `✅ *Gambar berhasil di-enhance!*\n\n` +
                `📊 **Detail Proses:**\n` +
                `• Ukuran Asli: ${originalSizeMB} MB\n` +
                `• Ukuran Hasil: ${resultSizeMB} MB\n` +
                `• Waktu Proses: ${processingTime} detik\n\n` +
                `🎯 *Resolusi dan kualitas telah ditingkatkan.*`;

            // Kirim gambar hasil dengan kualitas terbaik
            await bot.sendMessage(msg.from, {
                image: enhancedBuffer,
                caption: successCaption,
                mimetype: 'image/jpeg'
            }, { quoted: msg });

            await msg.react("✅");
            
            // Hapus pesan "sedang memproses"
            if (processingMessage?.key) {
                await bot.sendMessage(msg.from, { delete: processingMessage.key });
            }

        } catch (error) {
            console.error("❌ Error fatal pada perintah HD:", error);
            await msg.react("❌");
            await msg.reply(`❌ *Terjadi Kesalahan*\n\n**Pesan:** ${error.message}`);
        }
    }
};
