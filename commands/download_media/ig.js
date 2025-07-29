const axios = require("axios");
const cheerio = require("cheerio");

// Fallback ke yt1s.io dengan logika scraping yang lebih cerdas
async function instagramDl(url) {
    try {
        const { data } = await axios.post('https://yt1s.io/api/ajaxSearch', new URLSearchParams({ q: url, vt: 'ig' }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                'Referer': 'https://yt1s.io/'
            }
        });

        const $ = cheerio.load(data.data);
        const result = new Set(); // Menggunakan Set untuk menghindari duplikasi URL

        // Iterasi setiap container media untuk mengambil link utama saja
        $('div.dl-item').each((i, element) => {
            // Cari link download video (.mp4) terlebih dahulu
            let mediaUrl = $(element).find('a[href*=".mp4"]').attr('href');
            
            // Jika tidak ada video, baru cari link gambar
            if (!mediaUrl) {
                mediaUrl = $(element).find('a[href*=".jpg"]').attr('href');
            }

            if (mediaUrl) {
                result.add(mediaUrl);
            }
        });

        if (result.size === 0) {
            throw new Error("Tidak ada link unduhan yang ditemukan dalam respons API.");
        }

        return Array.from(result);

    } catch (e) {
        const errorMessage = e.response ? e.response.data : e.message;
        throw new Error(`Gagal saat scraping dari yt1s.io: ${errorMessage}`);
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
      
      const { fileTypeFromBuffer } = await import('file-type');

      for (const [index, mediaUrl] of mediaUrls.entries()) {
        const caption = `✅ Media ${index + 1}/${mediaUrls.length}`;
        try {
            const bufferResponse = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
            const buffer = bufferResponse.data;
            
            const type = await fileTypeFromBuffer(buffer);
            const mime = type ? type.mime : 'application/octet-stream';
            
            if (mime.startsWith('video/')) {
                 await bot.sendMessage(msg.from, { video: buffer, caption }, { quoted: msg });
            } else if (mime.startsWith('image/')) {
                 await bot.sendMessage(msg.from, { image: buffer, caption }, { quoted: msg });
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