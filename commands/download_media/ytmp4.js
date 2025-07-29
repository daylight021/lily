const ytdl = require('@distube/ytdl-core');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const TEMP_DIR = path.join(__dirname, '../../temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Global session storage untuk menyimpan URL terakhir setiap user
global.ytSessions = global.ytSessions || {};

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

async function getYtInfo(url) {
    const info = await ytdl.getInfo(url);
    const videoFormats = ytdl.filterFormats(info.formats, 'videoonly').filter(f => f.container === 'mp4');
    const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');

    if (videoFormats.length === 0 || audioFormats.length === 0) {
        throw new Error("Tidak ada format video/audio terpisah yang ditemukan.");
    }
    return { info, videoFormats, audioFormats };
}

function mergeVideoAudio(videoPath, audioPath, outputPath) {
    return new Promise((resolve, reject) => {
        const command = `ffmpeg -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac "${outputPath}"`;
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error('FFmpeg Error:', stderr);
                return reject(new Error(`Gagal menggabungkan file: ${stderr}`));
            }
            resolve(outputPath);
        });
    });
}

async function downloadVideo(msg, bot, url, quality, usedPrefix, command) {
    try {
        await msg.react("⏳");
        const { info, videoFormats, audioFormats } = await getYtInfo(url);
        const videoTitle = info.videoDetails.title;

        const selectedVideo = videoFormats.find(f => f.qualityLabel === quality);
        if (!selectedVideo) {
            await msg.react("⚠️");
            return msg.reply(`❌ Kualitas "${quality}" tidak ditemukan atau tidak valid.`);
        }

        const bestAudio = audioFormats.sort((a, b) => b.audioBitrate - a.audioBitrate)[0];

        await msg.reply(`✅ Memulai download video...\n\n` +
                      `🎬 *${videoTitle}*\n` +
                      `📊 *Kualitas:* ${quality}\n` +
                      `⏱️ *Durasi:* ${formatDuration(parseInt(info.videoDetails.lengthSeconds || 0))}\n\n` +
                      `⏳ Sedang mengunduh dan memproses... Ini mungkin memakan waktu. (Bisa sampai 3 - 5 menit atau bahkan lebih) Mohon tunggu😊`);

        const timestamp = Date.now();
        const videoPath = path.join(TEMP_DIR, `video_${timestamp}.mp4`);
        const audioPath = path.join(TEMP_DIR, `audio_${timestamp}.m4a`);
        const outputPath = path.join(TEMP_DIR, `output_${timestamp}.mp4`);

        const videoStream = (await axios.get(selectedVideo.url, { responseType: 'stream' })).data;
        const audioStream = (await axios.get(bestAudio.url, { responseType: 'stream' })).data;

        await Promise.all([
            new Promise(resolve => videoStream.pipe(fs.createWriteStream(videoPath)).on('finish', resolve)),
            new Promise(resolve => audioStream.pipe(fs.createWriteStream(audioPath)).on('finish', resolve))
        ]);

        await msg.reply("Menggabungkan video dan audio dengan FFmpeg...");
        await mergeVideoAudio(videoPath, audioPath, outputPath);

        await bot.sendMessage(msg.from, {
            video: fs.readFileSync(outputPath),
            mimetype: 'video/mp4',
            caption: `✅ *Download berhasil!*\n\n` +
                    `🎬 *${videoTitle}*\n` +
                    `📺 *Channel:* ${info.videoDetails.author?.name || 'N/A'}\n` +
                    `📊 *Kualitas:* ${quality}\n` +
                    `📁 *Ukuran File:* ${(fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2)} MB\n` +
                    `⏱️ *Durasi:* ${formatDuration(parseInt(info.videoDetails.lengthSeconds || 0))}\n\n` +
                    `🔗 *Link:* ${url}`
        }, { quoted: msg });

        await msg.react("✅");

        // Cleanup files
        fs.unlinkSync(videoPath);
        fs.unlinkSync(audioPath);
        fs.unlinkSync(outputPath);

        // Clear session setelah download selesai
        if (global.ytSessions && global.ytSessions[msg.sender]) {
            delete global.ytSessions[msg.sender];
        }

    } catch (err) {
        console.error("Proses unduh ytmp4 gagal:", err);
        await msg.react("⚠️");
        return msg.reply(`❌ Gagal memproses video.\n\n*Alasan:* ${err.message}`);
    }
}

module.exports = {
  name: "ytmp4",
  alias: ["ytv"],
  description: "Unduh video dari YouTube dengan pilihan kualitas HD.",
  execute: async (msg, { args, bot, usedPrefix, command }) => {
    const input = args[0];
    const quality = args[1];

    // Check jika ini adalah response dari button (format: "Download 1080p", "Download 720p", etc.)
    if (input && input.startsWith("Download ") && !quality) {
        const buttonQuality = input.replace("Download ", "");
        const sessionData = global.ytSessions && global.ytSessions[msg.sender];
        
        if (sessionData && sessionData.url) {
            // Ambil URL dari session dan proses download
            return await downloadVideo(msg, bot, sessionData.url, buttonQuality, usedPrefix, command);
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
        const { info, videoFormats } = await getYtInfo(url);
        const videoTitle = info.videoDetails.title;
        const thumbnailUrl = info.videoDetails.thumbnails.slice(-1)[0].url;

        // Jika quality sudah dipilih langsung
        if (quality) {
            return await downloadVideo(msg, bot, url, quality, usedPrefix, command);
        }

        // Tampilkan pilihan kualitas
        const uniqueQualities = [...new Set(videoFormats.map(f => f.qualityLabel))].filter(Boolean);
        if (uniqueQualities.length === 0) {
            return msg.reply("Tidak ada pilihan kualitas video yang tersedia untuk link ini.");
        }

        // Ambil informasi video detail
        const videoDetails = info.videoDetails;
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
        if (!global.ytSessions) global.ytSessions = {};
        global.ytSessions[msg.sender] = {
            url: url,
            timestamp: Date.now()
        };

        // Buat button dengan format yang mudah dideteksi
        const buttons = uniqueQualities.map(q => ({
            buttonId: `yt_quality_${q}`,
            buttonText: { displayText: `Download ${q}` },
            type: 1
        }));

        const buttonMessage = {
            caption: `🎬 *${videoTitle}*\n\n` +
                    `📺 *Channel:* ${channel}\n` +
                    `👀 *Views:* ${viewCount}\n` +
                    `👍 *Likes:* ${likes}\n` +
                    `⏱️ *Duration:* ${duration}\n` +
                    `📅 *Published:* ${uploadDate}\n\n` +
                    `📄 *Description:*\n${description}\n\n` +
                    `📥 *Pilih kualitas video untuk download:*`,
            footer: 'Powered by YouTube Downloader Bot',
            buttons: buttons,
            image: { url: thumbnailUrl },
            headerType: 4
        };

        await bot.sendMessage(msg.from, buttonMessage, { quoted: msg });
        
        // Set timeout untuk menghapus session setelah 5 menit
        setTimeout(() => {
            if (global.ytSessions && global.ytSessions[msg.sender] && global.ytSessions[msg.sender].timestamp) {
                delete global.ytSessions[msg.sender];
            }
        }, 5 * 60 * 1000); // 5 menit

        return;

    } catch (err) {
      console.error("Proses ytmp4 gagal:", err);
      await msg.react("⚠️");
      return msg.reply(`❌ Gagal memproses video.\n\n*Alasan:* ${err.message}`);
    }
  },
};