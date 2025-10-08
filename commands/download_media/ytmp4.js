const YTDlpWrap = require('yt-dlp-wrap').default;
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEMP_DIR = path.join(__dirname, '../../temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Global session storage untuk menyimpan URL terakhir setiap user
global.ytSessions = global.ytSessions || {};

// Inisialisasi yt-dlp dengan auto-download binary
const ytDlpPath = path.join(__dirname, '../../bin/yt-dlp');
const ytDlp = new YTDlpWrap(ytDlpPath);

// Auto-download binary jika belum ada
(async () => {
    try {
        const binDir = path.join(__dirname, '../../bin');
        if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
        
        if (!fs.existsSync(ytDlpPath)) {
            console.log('Downloading yt-dlp binary...');
            await YTDlpWrap.downloadFromGithub(ytDlpPath);
            fs.chmodSync(ytDlpPath, 0o755); // Make executable
            console.log('yt-dlp binary downloaded successfully!');
        }
    } catch (err) {
        console.error('Failed to download yt-dlp:', err);
    }
})();

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
    try {
        // Mengambil metadata video
        const metadata = await ytDlp.getVideoInfo(url);
        
        // Filter format video dan audio
        const videoFormats = metadata.formats
            .filter(f => f.vcodec !== 'none' && f.acodec === 'none' && f.ext === 'mp4')
            .sort((a, b) => (b.height || 0) - (a.height || 0));
        
        const audioFormats = metadata.formats
            .filter(f => f.acodec !== 'none' && f.vcodec === 'none')
            .sort((a, b) => (b.abr || 0) - (a.abr || 0));

        if (videoFormats.length === 0 || audioFormats.length === 0) {
            throw new Error("Tidak ada format video/audio terpisah yang ditemukan.");
        }

        return { metadata, videoFormats, audioFormats };
    } catch (err) {
        throw new Error(`Gagal mengambil info video: ${err.message}`);
    }
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
        const { metadata, videoFormats, audioFormats } = await getYtInfo(url);
        const videoTitle = metadata.title;

        // Cari format video berdasarkan resolusi yang dipilih
        const heightMap = {
            '2160p': 2160,
            '1440p': 1440,
            '1080p': 1080,
            '720p': 720,
            '480p': 480,
            '360p': 360,
            '240p': 240,
            '144p': 144
        };

        const targetHeight = heightMap[quality];
        const selectedVideo = videoFormats.find(f => f.height === targetHeight);
        
        if (!selectedVideo) {
            await msg.react("⚠️");
            return msg.reply(`❌ Kualitas "${quality}" tidak ditemukan atau tidak valid.`);
        }

        const bestAudio = audioFormats[0]; // Audio terbaik sudah di-sort

        await msg.reply(`✅ Memulai download video...\n\n` +
                      `🎬 *${videoTitle}*\n` +
                      `📊 *Kualitas:* ${quality}\n` +
                      `⏱️ *Durasi:* ${formatDuration(parseInt(metadata.duration || 0))}\n\n` +
                      `⏳ Sedang mengunduh dan memproses... Ini mungkin memakan waktu. (Bisa sampai 3 - 5 menit atau bahkan lebih) Mohon tunggu😊`);

        const timestamp = Date.now();
        const videoPath = path.join(TEMP_DIR, `video_${timestamp}.mp4`);
        const audioPath = path.join(TEMP_DIR, `audio_${timestamp}.m4a`);
        const outputPath = path.join(TEMP_DIR, `output_${timestamp}.mp4`);

        // Download video dan audio secara parallel menggunakan yt-dlp
        await Promise.all([
            ytDlp.execPromise([
                url,
                '-f', selectedVideo.format_id,
                '-o', videoPath,
                '--no-warnings',
                '--quiet'
            ]),
            ytDlp.execPromise([
                url,
                '-f', bestAudio.format_id,
                '-o', audioPath,
                '--no-warnings',
                '--quiet'
            ])
        ]);

        await msg.reply("Menggabungkan video dan audio dengan FFmpeg...");
        await mergeVideoAudio(videoPath, audioPath, outputPath);

        await bot.sendMessage(msg.from, {
            video: fs.readFileSync(outputPath),
            mimetype: 'video/mp4',
            caption: `✅ *Download berhasil!*\n\n` +
                    `🎬 *${videoTitle}*\n` +
                    `📺 *Channel:* ${metadata.uploader || metadata.channel || 'N/A'}\n` +
                    `📊 *Kualitas:* ${quality}\n` +
                    `📁 *Ukuran File:* ${(fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2)} MB\n` +
                    `⏱️ *Durasi:* ${formatDuration(parseInt(metadata.duration || 0))}\n\n` +
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

    // Check jika ini adalah response dari button
    if (input && input.startsWith("Download ") && !quality) {
        const buttonQuality = input.replace("Download ", "");
        const sessionData = global.ytSessions && global.ytSessions[msg.sender];
        
        if (sessionData && sessionData.url) {
            return await downloadVideo(msg, bot, sessionData.url, buttonQuality, usedPrefix, command);
        } else {
            return msg.reply("❌ Session expired. Silakan kirim ulang URL YouTube.");
        }
    }

    // Validasi URL normal (simple check)
    if (!input || !input.includes('youtube.com') && !input.includes('youtu.be')) {
      return msg.reply("❌ Masukkan URL YouTube yang valid.");
    }

    const url = input;

    try {
        await msg.react("⏳");
        const { metadata, videoFormats } = await getYtInfo(url);
        const videoTitle = metadata.title;
        const thumbnailUrl = metadata.thumbnail;

        // Jika quality sudah dipilih langsung
        if (quality) {
            return await downloadVideo(msg, bot, url, quality, usedPrefix, command);
        }

        // Ambil kualitas unik berdasarkan height
        const qualityMap = {
            2160: '2160p',
            1440: '1440p',
            1080: '1080p',
            720: '720p',
            480: '480p',
            360: '360p',
            240: '240p',
            144: '144p'
        };

        const uniqueQualities = [...new Set(
            videoFormats
                .filter(f => f.height && qualityMap[f.height])
                .map(f => qualityMap[f.height])
        )];

        if (uniqueQualities.length === 0) {
            return msg.reply("Tidak ada pilihan kualitas video yang tersedia untuk link ini.");
        }

        // Ambil informasi video detail
        const viewCount = formatNumber(metadata.view_count);
        const likes = formatNumber(metadata.like_count);
        const duration = metadata.duration ? formatDuration(parseInt(metadata.duration)) : 'N/A';
        const uploadDate = metadata.upload_date ? 
            `${metadata.upload_date.substring(0, 4)}-${metadata.upload_date.substring(4, 6)}-${metadata.upload_date.substring(6, 8)}` : 
            'N/A';
        const channel = metadata.uploader || metadata.channel || 'N/A';
        const description = metadata.description ? 
            (metadata.description.length > 100 ? 
                metadata.description.substring(0, 100) + '...' : 
                metadata.description) : 'N/A';
        
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
                    `🔥 *Pilih kualitas video untuk download:*`,
            footer: "Powered by 『∂αуℓιgнт』's Bot",
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
        }, 5 * 60 * 1000);

        return;

    } catch (err) {
      console.error("Proses ytmp4 gagal:", err);
      await msg.react("⚠️");
      return msg.reply(`❌ Gagal memproses video.\n\n*Alasan:* ${err.message}`);
    }
  },
};