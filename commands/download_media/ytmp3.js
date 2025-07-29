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
        console.log(`[YTMP3] Starting download for URL: ${url} with bitrate: ${bitrate}`);
        
        const { info, audioFormats } = await getYtInfo(url);
        const videoDetails = info.videoDetails;
        const videoTitle = videoDetails.title;

        // Pilih format audio berdasarkan bitrate yang diminta
        let selectedAudio;
        if (bitrate) {
            const requestedBitrate = parseInt(bitrate.replace('kbps', ''));
            selectedAudio = audioFormats.find(f => f.audioBitrate >= requestedBitrate) || audioFormats[0];
            console.log(`[YTMP3] Requested bitrate: ${requestedBitrate}, Selected: ${selectedAudio.audioBitrate}kbps`);
        } else {
            selectedAudio = audioFormats[0]; // Kualitas terbaik
            console.log(`[YTMP3] Using best quality: ${selectedAudio.audioBitrate}kbps`);
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

        console.log(`[YTMP3] Downloading from URL: ${selectedAudio.url}`);
        
        // Unduh ke buffer untuk stabilitas
        const response = await axios.get(selectedAudio.url, { 
            responseType: 'arraybuffer',
            timeout: 60000, // 60 detik timeout
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        console.log(`[YTMP3] Download completed, file size: ${(response.data.byteLength / (1024 * 1024)).toFixed(2)} MB`);

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
        console.log(`[YTMP3] Audio sent successfully to ${msg.from}`);

        // Clear session setelah download selesai
        if (global.ytmp3Sessions && global.ytmp3Sessions[msg.sender]) {
            delete global.ytmp3Sessions[msg.sender];
            console.log(`[YTMP3] Session cleared for ${msg.sender}`);
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

    console.log(`[YTMP3] Execute called with input: "${input}", bitrate: "${bitrate}"`);
    console.log(`[YTMP3] Args array:`, args);

    // Check jika ini adalah response dari button (format: "Download Audio 320kbps", etc.)
    if (input && input.startsWith("Download Audio ") && !bitrate) {
        console.log(`[YTMP3] Button response detected: "${input}"`);
        
        const buttonBitrate = input.replace("Download Audio ", "");
        console.log(`[YTMP3] Extracted bitrate from button: "${buttonBitrate}"`);
        
        const sessionData = global.ytmp3Sessions && global.ytmp3Sessions[msg.sender];
        
        if (sessionData && sessionData.url) {
            console.log(`[YTMP3] Found session data for ${msg.sender}: ${sessionData.url}`);
            // Ambil URL dari session dan proses download
            return await downloadAudio(msg, bot, sessionData.url, buttonBitrate, usedPrefix, command);
        } else {
            console.log(`[YTMP3] No session data found for ${msg.sender}`);
            console.log(`[YTMP3] Available sessions:`, Object.keys(global.ytmp3Sessions || {}));
            return msg.reply("❌ Session expired. Silakan kirim ulang URL YouTube.");
        }
    }

    // Validasi URL normal
    if (!input || !ytdl.validateURL(input)) {
      console.log(`[YTMP3] Invalid URL provided: "${input}"`);
      return msg.reply("❌ Masukkan URL YouTube yang valid.\n\nContoh: `.ytmp3 https://youtu.be/dQw4w9WgXcQ`");
    }

    const url = input;
    console.log(`[YTMP3] Processing URL: ${url}`);

    try {
        await msg.react("⏳");
        const { info, audioFormats } = await getYtInfo(url);
        const videoDetails = info.videoDetails;
        const videoTitle = videoDetails.title;
        const thumbnailUrl = videoDetails.thumbnails.slice(-1)[0].url;

        console.log(`[YTMP3] Got video info: "${videoTitle}"`);
        console.log(`[YTMP3] Available audio formats: ${audioFormats.length}`);

        // Jika bitrate sudah dipilih langsung
        if (bitrate) {
            console.log(`[YTMP3] Direct bitrate specified: ${bitrate}`);
            return await downloadAudio(msg, bot, url, bitrate, usedPrefix, command);
        }

        // Tampilkan pilihan bitrate
        const uniqueBitrates = [...new Set(audioFormats.map(f => f.audioBitrate))].filter(Boolean).sort((a, b) => b - a);
        console.log(`[YTMP3] Available bitrates:`, uniqueBitrates);
        
        if (uniqueBitrates.length === 0) {
            return msg.reply("❌ Tidak ada pilihan kualitas audio yang tersedia untuk link ini.");
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

        console.log(`[YTMP3] Session created for ${msg.sender} with URL: ${url}`);

        // Buat button dengan format yang mudah dideteksi
        const buttons = uniqueBitrates.slice(0, 3).map(bitrate => ({
            buttonId: `yt_audio_${bitrate}kbps`,
            buttonText: { displayText: `Download Audio ${bitrate}kbps` },
            type: 1
        }));

        console.log(`[YTMP3] Creating buttons:`, buttons.map(b => b.buttonText.displayText));

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
        console.log(`[YTMP3] Button message sent successfully`);
        
        // Set timeout untuk menghapus session setelah 5 menit
        setTimeout(() => {
            if (global.ytmp3Sessions && global.ytmp3Sessions[msg.sender] && global.ytmp3Sessions[msg.sender].timestamp) {
                console.log(`[YTMP3] Session timeout for ${msg.sender}`);
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