const ytdl = require('@distube/ytdl-core');
const axios = require('axios');

// Global session storage untuk menyimpan URL terakhir setiap user
global.ytmp3Sessions = global.ytmp3Sessions || {};

// Fungsi ini diadaptasi dari screaper.js
async function getYtInfo(url) {
    const info = await ytdl.getInfo(url);
    const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
    
    // Urutkan berdasarkan bitrate untuk mendapatkan kualitas terbaik
    audioFormats.sort((a, b) => b.audioBitrate - a.audioBitrate);

    if (audioFormats.length === 0) {
        throw new Error("Tidak ada format audio yang ditemukan.");
    }
    
    return { info, audioFormats };
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

async function downloadAudio(msg, bot, url, bitrate, usedPrefix, command) {
    try {
        await msg.react("⏳");
        const { info, audioFormats } = await getYtInfo(url);
        const videoDetails = info.videoDetails;
        const videoTitle = videoDetails.title;

        // Pilih format audio berdasarkan bitrate yang diminta
        let selectedAudio;
        if (bitrate) {
            const requestedBitrate = parseInt(bitrate.replace('kbps', ''));
            selectedAudio = audioFormats.find(f => f.audioBitrate >= requestedBitrate) || audioFormats[0];
        } else {
            selectedAudio = audioFormats[0]; // Kualitas terbaik
        }

        const viewCount = formatNumber(videoDetails.viewCount);
        const likes = formatNumber(videoDetails.likes);
        const duration = videoDetails.lengthSeconds ? formatDuration(parseInt(videoDetails.lengthSeconds)) : 'N/A';
        const uploadDate = videoDetails.publishDate || 'N/A';
        const channel = videoDetails.author?.name || videoDetails.ownerChannelName || 'N/A';

        await msg.reply(`🎵 Memulai download audio...\n\n` +
                        `🎬 *${videoTitle}*\n` +
                        `📺 *${channel}*\n` +
                        `🎵 *Bitrate:* ${selectedAudio.audioBitrate || 'Auto'}kbps\n` +
                        `⏱️ *Durasi:* ${duration}\n\n` +
                        `⏳ Sedang mengunduh dan memproses... Mohon tunggu.`);

        // Unduh ke buffer untuk stabilitas
        const response = await axios.get(selectedAudio.url, { responseType: 'arraybuffer' });

        await bot.sendMessage(msg.from, { 
            audio: response.data, 
            mimetype: 'audio/mpeg',
            caption: 
            `🎵 *Download berhasil!*\n\n` +
            `🎬 *${videoTitle}*\n` +
            `📺 *Channel:* ${channel}\n` +
            `👀 *Views:* ${viewCount}\n` +
            `👍 *Likes:* ${likes}\n` +
            `🎵 *Bitrate:* ${selectedAudio.audioBitrate || 'Auto'}kbps\n` +
            `📁 *Ukuran File:* ${(response.data.byteLength / (1024 * 1024)).toFixed(2)} MB\n` +
            `⏱️ *Durasi:* ${duration}\n` +
            `📅 *Published:* ${uploadDate}\n\n` +
            `🔗 *Link:* ${url}`
        }, { quoted: msg });

        await msg.react("✅");

        // Clear session setelah download selesai
        if (global.ytmp3Sessions && global.ytmp3Sessions[msg.sender]) {
            delete global.ytmp3Sessions[msg.sender];
        }

    } catch (err) {
        console.error("Proses unduh ytmp3 gagal:", err);
        await msg.react("⚠️");
        return msg.reply(`❌ Gagal mengunduh audio.\n\n*Alasan:* ${err.message}`);
    }
}

module.exports = {
  name: "ytmp3",
  alias: ["yta"],
  description: "Unduh audio dari link YouTube dengan pilihan kualitas.",
  execute: async (msg, { args, bot, usedPrefix, command }) => {
    const input = args[0];
    const bitrate = args[1];

    // Check jika ini adalah response dari button (format: "Download Audio 320kbps", etc.)
    if (input && input.startsWith("Download Audio ") && !bitrate) {
        const buttonBitrate = input.replace("Download Audio ", "");
        const sessionData = global.ytmp3Sessions && global.ytmp3Sessions[msg.sender];
        
        if (sessionData && sessionData.url) {
            // Ambil URL dari session dan proses download
            return await downloadAudio(msg, bot, sessionData.url, buttonBitrate, usedPrefix, command);
        } else {
            return msg.reply("❌ Session expired. Silakan kirim ulang URL YouTube.");
        }
    }

    // Validasi URL normal
    if (!input || !ytdl.validateURL(input)) {
      return msg.reply("❌ Masukkan URL YouTube yang valid.");
    }

    const url = input;

    try {
        await msg.react("⏳");
        const { info, audioFormats } = await getYtInfo(url);
        const videoDetails = info.videoDetails;
        const videoTitle = videoDetails.title;
        const thumbnailUrl = videoDetails.thumbnails.slice(-1)[0].url;

        // Jika bitrate sudah dipilih langsung
        if (bitrate) {
            return await downloadAudio(msg, bot, url, bitrate, usedPrefix, command);
        }

        // Tampilkan pilihan bitrate
        const uniqueBitrates = [...new Set(audioFormats.map(f => f.audioBitrate))].filter(Boolean).sort((a, b) => b - a);
        if (uniqueBitrates.length === 0) {
            return msg.reply("Tidak ada pilihan kualitas audio yang tersedia untuk link ini.");
        }

        // Ambil informasi video detail
        const viewCount = formatNumber(videoDetails.viewCount);
        const likes = formatNumber(videoDetails.likes);
        const duration = videoDetails.lengthSeconds ? formatDuration(parseInt(videoDetails.lengthSeconds)) : 'N/A';
        const uploadDate = videoDetails.publishDate || 'N/A';
        const channel = videoDetails.author?.name || videoDetails.ownerChannelName || 'N/A';
        const description = videoDetails.description ? 
            (videoDetails.description.length > 100 ? 
                videoDetails.description.substring(0, 100) + '...' : 
                videoDetails.description) : 'N/A';

        // Simpan URL di session untuk user ini
        if (!global.ytmp3Sessions) global.ytmp3Sessions = {};
        global.ytmp3Sessions[msg.sender] = {
            url: url,
            timestamp: Date.now()
        };

        // Buat button dengan format yang mudah dideteksi
        const buttons = uniqueBitrates.slice(0, 3).map(bitrate => ({
            buttonId: `yt_audio_${bitrate}kbps`,
            buttonText: { displayText: `Download Audio ${bitrate}kbps` },
            type: 1
        }));

        const buttonMessage = {
            caption: `🎵 *${videoTitle}*\n\n` +
                    `📺 *Channel:* ${channel}\n` +
                    `👀 *Views:* ${viewCount}\n` +
                    `👍 *Likes:* ${likes}\n` +
                    `⏱️ *Duration:* ${duration}\n` +
                    `📅 *Published:* ${uploadDate}\n\n` +
                    `📄 *Description:*\n${description}\n\n` +
                    `🎵 *Pilih kualitas audio untuk download:*`,
            footer: 'Powered by YouTube Audio Downloader Bot',
            buttons: buttons,
            image: { url: thumbnailUrl },
            headerType: 4
        };

        await bot.sendMessage(msg.from, buttonMessage, { quoted: msg });
        
        // Set timeout untuk menghapus session setelah 5 menit
        setTimeout(() => {
            if (global.ytmp3Sessions && global.ytmp3Sessions[msg.sender] && global.ytmp3Sessions[msg.sender].timestamp) {
                delete global.ytmp3Sessions[msg.sender];
            }
        }, 5 * 60 * 1000); // 5 menit

        return;

    } catch (err) {
      console.error("Proses ytmp3 gagal:", err);
      await msg.react("⚠️");
      return msg.reply(`❌ Gagal memproses audio.\n\n*Alasan:* ${err.message}`);
    }
  },
};