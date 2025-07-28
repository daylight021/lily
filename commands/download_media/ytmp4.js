const ytdl = require('@distube/ytdl-core');
const axios = require('axios');

// Fungsi untuk memformat durasi dari detik menjadi HH:MM:SS atau MM:SS
function formatDuration(seconds) {
    if (seconds > 3600) {
        return new Date(seconds * 1000).toISOString().substr(11, 8);
    } else {
        return new Date(seconds * 1000).toISOString().substr(14, 5);
    }
}

// Fungsi untuk memformat angka (misal: 1500 -> 1.5K)
function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return num;
}

// Fungsi untuk mendapatkan link download dari API eksternal (lebih stabil)
async function getVideoDownloadLink(videoId, quality) {
    try {
        const response = await axios.post(`https://co.wuk.sh/api/json`, {
            url: `https://www.youtube.com/watch?v=${videoId}`,
            vQuality: quality.replace('p', ''), // Kirim kualitas tanpa 'p'
            isAudioOnly: false
        }, {
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }
        });

        if (response.data.status === 'stream') {
            return response.data.url;
        } else {
            throw new Error(response.data.text || "Gagal mendapatkan link unduhan dari API.");
        }
    } catch (error) {
        console.error("Error saat mengambil link unduhan:", error.message);
        throw new Error("Gagal berkomunikasi dengan server unduhan. Coba lagi nanti.");
    }
}


module.exports = {
  name: "ytmp4",
  alias: ["ytv"],
  description: "Unduh video dari YouTube dengan pilihan kualitas.",
  execute: async (msg, { bot, args, usedPrefix, command }) => {
    const url = args[0];
    const quality = args[1];

    if (!url || !ytdl.validateURL(url)) {
      return msg.reply(`❌ Masukkan URL YouTube yang valid.\nContoh: *${usedPrefix + command} https://youtu.be/example*`);
    }

    const videoId = ytdl.getVideoID(url);

    try {
        await msg.react("⏳");
        
        const info = await ytdl.getInfo(videoId);
        const details = info.videoDetails;
        
        // --- Jika Kualitas Belum Dipilih ---
        if (!quality) {
            // 1. Kumpulkan informasi video
            const videoTitle = details.title;
            const thumbnailUrl = details.thumbnails.slice(-1)[0].url;
            const views = formatNumber(details.viewCount);
            const likes = formatNumber(details.likes);
            const duration = formatDuration(details.lengthSeconds);

            // 2. Buat caption yang informatif
            let caption = `*${videoTitle}*\n\n`;
            caption += `👀 Tayangan: *${views}*\n`;
            caption += `👍 Suka: *${likes}*\n`;
            caption += `⏳ Durasi: *${duration}*\n\n`;
            caption += `Silakan pilih salah satu kualitas video di bawah ini:`;

            // 3. Filter format video yang tersedia
            const formats = ytdl.filterFormats(info.formats, 'videoandaudio').filter(f => f.container === 'mp4' && f.hasVideo && f.hasAudio);
            const uniqueQualities = [...new Set(formats.map(f => f.qualityLabel))].filter(Boolean).sort((a, b) => parseInt(b) - parseInt(a));

            if (uniqueQualities.length === 0) {
                return msg.reply("Tidak ada pilihan kualitas video MP4 yang tersedia untuk link ini.");
            }

            // 4. Buat tombol template (quick reply)
            const templateButtons = uniqueQualities.map((q, i) => ({
                index: i + 1,
                quickReplyButton: { 
                    displayText: `Kualitas ${q}`, 
                    // ID ini adalah perintah lengkap yang akan dikirim pengguna saat tombol diklik
                    id: `${usedPrefix + command} ${url} ${q}` 
                }
            }));
            
            // 5. Kirim pesan template
            const templateMessage = {
                text: caption,
                footer: bot.user.name,
                templateButtons: templateButtons,
                image: { url: thumbnailUrl }
            };
            
            await bot.sendMessage(msg.from, templateMessage, { quoted: msg });
            return;
        }

        // --- Jika Kualitas SUDAH Dipilih ---
        await msg.reply(`✅ Memproses video *'${details.title}'* (${quality})...`);

        const downloadLink = await getVideoDownloadLink(videoId, quality);

        // Kirim video langsung dari URL download
        await bot.sendMessage(msg.from, { 
            video: { url: downloadLink },
            mimetype: 'video/mp4',
            caption: `✅ Video berhasil diunduh:\n*${details.title}* (${quality})`
        }, { quoted: msg });

        await msg.react("✅");

    } catch (err) {
      console.error("Proses unduh ytmp4 gagal:", err);
      await msg.react("⚠️");
      return msg.reply(`❌ Gagal memproses video.\n\n*Alasan:* ${err.message}`);
    }
  },
};