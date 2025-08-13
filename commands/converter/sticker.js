const { downloadMediaMessage } = require("lily-baileys");
const { createSticker, detectMediaType } = require("../../lib/sticker.js");

module.exports = {
  name: "sticker",
  alias: ["s"],
  description: "Ubah gambar/video/dokumen menjadi stiker. Mendukung format: JPG, PNG, GIF, WebP, MP4, WebM, MOV, AVI, MKV, TGS",
  execute: async (msg, { bot }) => {
    
    let targetMsg = msg.quoted || msg;
    
    const validTypes = ['imageMessage', 'videoMessage', 'documentMessage'];
    if (!validTypes.includes(targetMsg.type)) {
        return msg.reply("❌ Kirim atau reply media yang valid dengan caption `.s`.\n\n📋 Format yang didukung:\n• Gambar: JPG, PNG, GIF, WebP\n• Video: MP4, WebM, MOV, AVI, MKV\n• Stiker: TGS (Telegram Sticker)\n• Durasi video maksimal: 10 detik");
    }

    // Validasi untuk tipe dokumen
    if (targetMsg.type === 'documentMessage') {
        const mimetype = targetMsg.msg?.mimetype || '';
        const fileName = targetMsg.msg?.fileName || '';
        
        console.log(`Document mimetype: ${mimetype}, fileName: ${fileName}`);
        
        const supportedMimes = [
            'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
            'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska',
            'application/json', 'application/x-tgsticker'
        ];
        
        const supportedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.webm', '.mov', '.avi', '.mkv', '.tgs'];
        
        const hasValidMime = supportedMimes.some(mime => mimetype.includes(mime));
        const hasValidExt = supportedExts.some(ext => fileName.toLowerCase().includes(ext));
        
        if (!hasValidMime && !hasValidExt) {
            return msg.reply("❌ Dokumen yang dikirim bukan media yang didukung.\n\n📋 Format yang didukung:\n• Gambar: JPG, PNG, GIF, WebP\n• Video: MP4, WebM, MOV, AVI, MKV\n• Stiker: TGS (Telegram Sticker)");
        }
    }

    await msg.react("⏳");
    
    try {
        console.log("Starting sticker creation process...");
        console.log(`Message type: ${targetMsg.type}`);
        
        // Download media
        const messageToDownload = targetMsg.isViewOnce ? targetMsg.raw : targetMsg;
        console.log("Downloading media message...");
        
        const buffer = await downloadMediaMessage(
            messageToDownload,
            "buffer",
            {},
            { reuploadRequest: bot.updateMediaMessage }
        );

        console.log(`Downloaded buffer size: ${buffer.length} bytes`);
        
        // Siapkan opsi stiker
        const stickerOptions = {
            pack: process.env.stickerPackname || "Bot Stiker",
            author: process.env.stickerAuthor || "Dibuat oleh Bot",
            mimetype: targetMsg.msg?.mimetype || ''
        };

        // Deteksi tipe media
        const mediaType = detectMediaType(buffer, stickerOptions.mimetype);
        console.log(`Detected media type: ${mediaType}`);

        // Validasi ukuran file
        const maxSize = 10 * 1024 * 1024; // 10MB
        if (buffer.length > maxSize) {
            await msg.react("⚠️");
            return msg.reply("❌ Ukuran file terlalu besar! Maksimal 10MB.\n\n💡 Tips: Kompres video atau gunakan durasi yang lebih pendek.");
        }

        // Buat stiker menggunakan auto-detection
        console.log("Creating sticker with auto-detection...");
        const sticker = await createSticker(buffer, stickerOptions);
        
        // Kirim stiker
        console.log("Sending sticker...");
        await bot.sendMessage(msg.from, await sticker.toMessage(), { quoted: msg });
        await msg.react("✅");
        
        console.log("Sticker sent successfully!");

    } catch (err) {
        console.error("Kesalahan saat konversi stiker:", err);
        await msg.react("⚠️");
        
        // Error handling yang lebih spesifik
        if (err.message.includes('Puppeteer not installed')) {
            return msg.reply("❌ TGS sticker memerlukan Puppeteer untuk diproses.\n\n🔧 Install dengan: `npm install puppeteer`\n💡 Atau kirim file TGS sebagai gambar/video biasa.");
        }
        
        if (err.message.includes('Image conversion failed') && err.message.includes('both failed')) {
            return msg.reply("❌ File yang dikirim corrupt atau tidak dapat diproses.\n\n💡 Tips:\n• Pastikan file tidak rusak\n• Coba kirim ulang file tersebut\n• Gunakan format file yang lebih umum (JPG/PNG untuk gambar, MP4 untuk video)");
        }
        
        if (err.message.includes('FFmpeg conversion failed') || err.message.includes('Error while decoding')) {
            return msg.reply("❌ Gagal memproses file dengan FFmpeg.\n\n💡 File mungkin corrupt atau format tidak didukung.\n🔄 Coba convert file ke format standar (JPG/PNG/MP4) terlebih dahulu.");
        }
        
        if (err.message.includes('No video stream found')) {
            return msg.reply("❌ File yang dikirim tidak memiliki stream video yang valid.\n\n💡 Pastikan file video tidak corrupt.");
        }
        
        if (err.message.includes('size limits')) {
            return msg.reply("❌ Gagal membuat stiker dalam batas ukuran yang diizinkan.\n\n💡 Tips:\n• Gunakan video yang lebih pendek (maks 10 detik)\n• Kompres video terlebih dahulu\n• Gunakan resolusi yang lebih kecil");
        }
        
        if (err.message.includes('Invalid duration')) {
            return msg.reply("❌ Durasi video tidak valid atau file corrupt.\n\n💡 Tips:\n• Pastikan file video tidak rusak\n• Coba convert ulang video Anda\n• Gunakan format video standar (MP4)");
        }
        
        if (err.message.includes('too large') || buffer.length > 10 * 1024 * 1024) {
            return msg.reply("❌ Ukuran media terlalu besar (maks 10MB).\n\n💡 Tips untuk mengurangi ukuran:\n• Kompres video/gambar\n• Potong durasi video\n• Turunkan kualitas/resolusi");
        }
        
        if (err.message.includes('ENOENT') || err.message.includes('spawn')) {
            return msg.reply("❌ Error sistem dalam memproses media.\n\n🔧 Coba lagi dalam beberapa saat atau kontak admin.");
        }
        
        // Generic error
        return msg.reply("❌ Gagal membuat stiker. Pastikan media yang dikirim valid.\n\n📋 Format yang didukung:\n• Gambar: JPG, PNG, GIF, WebP\n• Video: MP4, WebM, MOV, AVI, MKV (maks 10 detik)\n• Stiker: TGS (Telegram Sticker)\n\n💡 Tips:\n• Pastikan file tidak corrupt\n• Ukuran file maksimal 10MB\n• Untuk video, durasi maksimal 10 detik\n• Untuk TGS, pastikan Puppeteer terinstal");
    }
  },
};
