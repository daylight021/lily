const axios = require("axios");

async function instagramDl(url) {
    try {
        const response = await axios.post('https://snapinsta.app/api/ajaxSearch', new URLSearchParams({
            q: url,
            vt: 'home'
        }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                'Referer': 'https://snapinsta.app/'
            }
        });

        const data = response.data;
        if (data.status !== 'ok' || !data.data) {
            throw new Error('Gagal mendapatkan data dari Snapinsta atau URL tidak valid.');
        }

        // Regex untuk mengekstrak URL dari HTML yang dikembalikan
        const regex = /<a href="([^"]+)" target="_blank" class="download-btn" rel="noopener noreferrer nofollow">Download<\/a>/g;
        let match;
        const mediaUrls = [];

        // Loop melalui semua link download yang ditemukan
        while ((match = regex.exec(data.data)) !== null) {
            if (!match[1].endsWith('jpeg.jpg') && !match[1].endsWith('webp.webp')) {
                 mediaUrls.push(match[1]);
            }
        }
        
        if (mediaUrls.length === 0) {
            throw new Error("Tidak ada media yang dapat diunduh ditemukan.");
        }

        return mediaUrls;

    } catch (e) {
        throw new Error(`API Snapinsta gagal: ${e.message}`);
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