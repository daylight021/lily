const yts = require('yt-search');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const TEMP_DIR = path.join(__dirname, '../../temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Fungsi baru untuk mengambil link unduhan (menggunakan API eksternal untuk stabilitas)
async function getVideoDownloadLink(url, quality) {
    try {
        const videoId = url.match(/(?:v=|\/|embed\/|youtu.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
        if (!videoId) throw new Error("Video ID tidak valid.");

        // Menggunakan API dari cobalt.tools yang lebih andal
        const response = await axios.post(`https://co.wuk.sh/api/json`, {
            url: `https://www.youtube.com/watch?v=${videoId}`,
            vQuality: quality.replace('p', ''), // Kirim kualitas tanpa 'p'
            isAudioOnly: false
        }, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        if (response.data.status === 'stream') {
            return response.data.url;
        } else {
            throw new Error(response.data.text || "Gagal mendapatkan link unduhan.");
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
    const quality = args[1]; // Kualitas yang dipilih (misal: 1080p)

    if (!url) return msg.reply("❌ Masukkan URL YouTube yang valid.");
    
    const videoId = url.match(/(?:v=|\/|embed\/|youtu.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
    if (!videoId) return msg.reply("❌ URL YouTube tidak valid atau tidak dapat menemukan Video ID.");

    try {
        await msg.react("⏳");
        
        // Menggunakan ytdl-core untuk mendapatkan info (lebih andal untuk metadata)
        const ytdl = require('@distube/ytdl-core');
        const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
        const videoTitle = info.videoDetails.title;
        const thumbnailUrl = info.videoDetails.thumbnails.slice(-1)[0].url;

        // Jika kualitas belum dipilih, tawarkan tombol
        if (!quality) {
            const formats = ytdl.filterFormats(info.formats, 'videoandaudio').filter(f => f.container === 'mp4' && f.hasVideo && f.hasAudio);
            const uniqueQualities = [...new Set(formats.map(f => f.qualityLabel))].filter(Boolean);

            if (uniqueQualities.length === 0) {
                return msg.reply("Tidak ada pilihan kualitas video yang tersedia untuk link ini.");
            }

            // Kita gunakan hydratedTemplate untuk memastikan 'id' (perintah) yang dikirim
            const templateButtons = uniqueQualities.map((q, i) => ({
                index: i + 1,
                // Tombol ini akan mengirim 'id' sebagai balasan
                quickReplyButton: { 
                    displayText: `Kualitas ${q}`, 
                    id: `${usedPrefix + command} ${url} ${q}` 
                }
            }));
            
            const templateMessage = {
                text: `*${videoTitle}*\n\nSilakan pilih salah satu kualitas video di bawah ini:`,
                footer: bot.user.name,
                templateButtons: templateButtons,
                image: { url: thumbnailUrl }
            };
            
            await bot.sendMessage(msg.from, templateMessage, { quoted: msg });
            return;
        }

        await msg.reply(`✅ Memproses video *(${quality})*...`);

        // Mengunduh menggunakan API eksternal yang lebih stabil
        const downloadLink = await getVideoDownloadLink(url, quality);

        await bot.sendMessage(msg.from, { 
            video: { url: downloadLink },
            mimetype: 'video/mp4',
            caption: `✅ Video berhasil diunduh:\n*${videoTitle}* (${quality})`
        }, { quoted: msg });

        await msg.react("✅");

    } catch (err) {
      console.error("Proses unduh ytmp4 gagal:", err);
      await msg.react("⚠️");
      return msg.reply(`❌ Gagal memproses video.\n\n*Alasan:* ${err.message}`);
    }
  },
};