const axios = require('axios');

/**
 * =================================================================
 * FUNGSI IG Downloader BARU (API Method)
 * =================================================================
 * Menggunakan API publik yang mengembalikan data JSON, lebih stabil
 * daripada scraping HTML.
 */
async function instagramDl(url) {
    try {
        // Menggunakan API dari i-downloader.com
        const response = await axios.get(`https://api.i-downloader.com/api/media?url=${encodeURIComponent(url)}`);

        const data = response.data;
        if (!data.data || data.data.length === 0) {
            throw new Error('API tidak mengembalikan media atau URL tidak valid.');
        }

        // Ekstrak semua URL media dari respons JSON
        const mediaUrls = data.data.map(item => item.url);

        if (mediaUrls.length === 0) {
            throw new Error("Tidak ada media yang dapat diunduh ditemukan.");
        }

        return mediaUrls;

    } catch (e) {
        // Cek jika error berasal dari axios atau logika kita
        const errorMessage = e.response ? e.response.data?.message : e.message;
        throw new Error(`API i-downloader gagal: ${errorMessage || 'Kesalahan tidak diketahui'}`);
    }
}

module.exports = {
  name: "ig",
  description: "Unduh media dari Instagram.",
  execute: async (msg, { args, bot }) => {
    const url = args[0];
    if (!url || !url.includes("instagram.com")) {
      return msg.reply("❌ Masukkan URL Instagram yang valid.");
    }

    await msg.react("⏳");

    try {
      const mediaUrls = await instagramDl(url);
      
      if (!mediaUrls || mediaUrls.length === 0) {
          throw new Error("Gagal mengekstrak media dari link tersebut.");
      }

      await msg.reply(`✅ Berhasil mendapatkan ${mediaUrls.length} media. Mengirim...`);
      
      // Impor file-type secara dinamis
      const { fileTypeFromBuffer } = await import('file-type');

      for (const [index, mediaUrl] of mediaUrls.entries()) {
        const caption = `✅ Media ${index + 1}/${mediaUrls.length}`;
        try {
            const bufferResponse = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
            const buffer = bufferResponse.data;
            
            const type = await fileTypeFromBuffer(buffer);
            const mime = type ? type.mime : 'application/octet-stream';
            
            if (mime.startsWith('video/')) {
                 await bot.sendMessage(msg.from, { video: buffer, caption, mimetype: 'video/mp4' }, { quoted: msg });
            } else if (mime.startsWith('image/')) {
                 await bot.sendMessage(msg.from, { image: buffer, caption, mimetype: 'image/jpeg' }, { quoted: msg });
            }
            
        } catch (sendError) {
            console.error(`Gagal mengirim media dari URL: ${mediaUrl}`, sendError);
            await msg.reply(`⚠️ Gagal mengirim media ${index + 1}.`);
        }
      }

      await msg.react("✅");

    } catch (err) {
      console.error("Proses unduh gagal total:", err);
      await msg.react("⚠️");
      return msg.reply(`❌ Gagal mengunduh media.\n\n*Alasan:* ${err.message}`);
    }
  },
};