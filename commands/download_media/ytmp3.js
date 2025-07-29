const ytdl = require('@distube/ytdl-core');
const axios = require('axios');

// Fungsi ini diadaptasi dari screaper.js
async function getYtAudio(url) {
    const info = await ytdl.getInfo(url);
    const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
    
    // Urutkan berdasarkan bitrate untuk mendapatkan kualitas terbaik
    audioFormats.sort((a, b) => b.audioBitrate - a.audioBitrate);

    if (audioFormats.length === 0) {
        throw new Error("Tidak ada format audio yang ditemukan.");
    }
    
    return {
        info,
        url: audioFormats[0].url,
        videoFormats,
        audioFormats
    };
}

// Helper function untuk format durasi
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
}

// Helper function untuk format angka
function formatNumber(num) {
    if (!num) return 'N/A';
    const number = parseInt(num);
    if (number >= 1000000000) {
        return (number / 1000000000).toFixed(1) + 'B';
    } else if (number >= 1000000) {
        return (number / 1000000).toFixed(1) + 'M';
    } else if (number >= 1000) {
        return (number / 1000).toFixed(1) + 'K';
    }
    return number.toLocaleString('id-ID');
}

module.exports = {
  name: "ytmp3",
  alias: ["yta"],
  description: "Unduh audio dari link YouTube.",
  execute: async (msg, { args, bot }) => {
    const url = args[0];
    if (!url || !ytdl.validateURL(url)) {
      return msg.reply("❌ Masukkan URL YouTube yang valid.");
    }

    await msg.react("⏳");
    await msg.reply('Audio sedang diproses... Mohon tunggu 😊');

    try {
      const info = await getYtAudio(url);
      const videoDetails = info.videoDetails;
      const viewCount = formatNumber(videoDetails.viewCount);
      const videoTitle = info.videoDetails.title;
      const duration = videoDetails.lengthSeconds ? formatDuration(parseInt(videoDetails.lengthSeconds)) : 'N/A';
      const uploadDate = videoDetails.publishDate || 'N/A';

      // Unduh ke buffer untuk stabilitas
      const buffer = await axios.get(info.url, { responseType: 'arraybuffer' });

      await bot.sendMessage(msg.from, { 
          audio: buffer.data, 
          mimetype: 'audio/mpeg',
          caption: 
          `🎬 *${videoTitle}*\n` +
          `📺 *Channel:* ${info.videoDetails.author?.name || 'N/A'}\n` +
          `👀 *Views:* ${viewCount}\n` +
          `⏱️ *Duration:* ${duration}\n` +
          `📅 *Published:* ${uploadDate}\n\n` +
          `🔗 *Link:* ${url}`
      }, { quoted: msg });

      await msg.react("✅");

    } catch (err) {
      console.error("Proses unduh ytmp3 gagal:", err);
      await msg.react("⚠️");
      return msg.reply(`❌ Gagal mengunduh audio.\n\n*Alasan:* ${err.message}`);
    }
  },
};