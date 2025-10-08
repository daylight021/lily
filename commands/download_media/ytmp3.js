const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execAsync = promisify(exec);

const TEMP_DIR = path.join(__dirname, '../../temp');
const YT_DLP_PATH = path.join(__dirname, '../../bin/yt-dlp');

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Global session storage untuk menyimpan URL terakhir setiap user
global.ytmp3Sessions = global.ytmp3Sessions || {};

// Get Python command (prioritize Python 3.11+)
function getPythonCommand() {
    const pythonVersions = ['python3.11', 'python3.10', 'python3.9', 'python3'];
    for (const py of pythonVersions) {
        try {
            const { stdout } = require('child_process').execSync(`which ${py}`, { encoding: 'utf8' });
            if (stdout.trim()) return py;
        } catch (e) {
            continue;
        }
    }
    return 'python3'; // fallback
}

const PYTHON_CMD = getPythonCommand();

// Check if yt-dlp binary exists
function checkYtDlpBinary() {
    if (!fs.existsSync(YT_DLP_PATH)) {
        throw new Error(
            `yt-dlp binary not found!\n\n` +
            `Please run:\n` +
            `cd ${path.dirname(YT_DLP_PATH)}\n` +
            `wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -O yt-dlp\n` +
            `chmod +x yt-dlp`
        );
    }
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

async function getYtInfo(url) {
    try {
        checkYtDlpBinary();
        
        // Detect if yt-dlp is a standalone binary or Python script
        let command;
        try {
            const { stdout: fileType } = await execAsync(`file "${YT_DLP_PATH}"`);
            if (fileType.includes('ELF') || fileType.includes('executable')) {
                // Standalone binary - run directly
                command = `"${YT_DLP_PATH}" --dump-json --no-warnings "${url}"`;
            } else {
                // Python script - use Python interpreter
                command = `${PYTHON_CMD} "${YT_DLP_PATH}" --dump-json --no-warnings "${url}"`;
            }
        } catch (e) {
            // Fallback: try direct execution first
            command = `"${YT_DLP_PATH}" --dump-json --no-warnings "${url}"`;
        }
        
        const { stdout } = await execAsync(command);
        const metadata = JSON.parse(stdout);
        
        const audioFormats = metadata.formats
            .filter(f => f.acodec !== 'none' && f.vcodec === 'none')
            .sort((a, b) => (b.abr || 0) - (a.abr || 0));

        if (audioFormats.length === 0) {
            throw new Error("Tidak ada format audio yang ditemukan.");
        }

        return { metadata, audioFormats };
    } catch (err) {
        throw new Error(`Gagal mengambil info video: ${err.message}`);
    }
}

async function downloadAudio(msg, bot, url, bitrate, usedPrefix, command) {
    let audioPath;
    
    try {
        await msg.react("⏳");
        console.log(`[YTMP3] Starting download for URL: ${url} with bitrate: ${bitrate}`);
        
        const { metadata, audioFormats } = await getYtInfo(url);
        const videoTitle = metadata.title;

        // Pilih format audio berdasarkan bitrate yang diminta
        let selectedAudio;
        if (bitrate) {
            const requestedBitrate = parseInt(bitrate.replace('kbps', ''));
            selectedAudio = audioFormats.find(f => (f.abr || 0) >= requestedBitrate) || audioFormats[0];
            console.log(`[YTMP3] Requested bitrate: ${requestedBitrate}, Selected: ${selectedAudio.abr || 'N/A'}kbps`);
        } else {
            selectedAudio = audioFormats[0]; // Kualitas terbaik
            console.log(`[YTMP3] Using best quality: ${selectedAudio.abr || 'N/A'}kbps`);
        }

        const viewCount = formatNumber(metadata.view_count);
        const likes = formatNumber(metadata.like_count);
        const duration = metadata.duration ? formatDuration(parseInt(metadata.duration)) : 'N/A';
        const uploadDate = metadata.upload_date ? 
            `${metadata.upload_date.substring(0, 4)}-${metadata.upload_date.substring(4, 6)}-${metadata.upload_date.substring(6, 8)}` : 
            'N/A';
        const channel = metadata.uploader || metadata.channel || 'N/A';

        await msg.reply(`🎵 Memulai download audio...\n\n` +
                        `🎬 *${videoTitle}*\n` +
                        `📺 *${channel}*\n` +
                        `🎵 *Bitrate:* ${selectedAudio.abr || 'Auto'}kbps\n` +
                        `⏱️ *Durasi:* ${duration}\n\n` +
                        `⏳ Sedang mengunduh dan memproses... Mohon tunggu.`);

        const timestamp = Date.now();
        audioPath = path.join(TEMP_DIR, `audio_${timestamp}.mp3`);

        console.log(`[YTMP3] Downloading audio...`);
        
        // Detect execution method
        let ytdlpCmd;
        try {
            const { stdout: fileType } = await execAsync(`file "${YT_DLP_PATH}"`);
            ytdlpCmd = fileType.includes('ELF') || fileType.includes('executable') ? 
                `"${YT_DLP_PATH}"` : `${PYTHON_CMD} "${YT_DLP_PATH}"`;
        } catch (e) {
            ytdlpCmd = `"${YT_DLP_PATH}"`;
        }
        
        // Download audio menggunakan yt-dlp dengan konversi ke mp3
        await execAsync(`${ytdlpCmd} -f ${selectedAudio.format_id} -x --audio-format mp3 -o "${audioPath}" --no-warnings "${url}"`);

        console.log(`[YTMP3] Download completed, file size: ${(fs.statSync(audioPath).size / (1024 * 1024)).toFixed(2)} MB`);

        await bot.sendMessage(msg.from, { 
            audio: fs.readFileSync(audioPath), 
            mimetype: 'audio/mpeg',
            caption: 
            `🎵 *Download berhasil!*\n\n` +
            `🎬 *${videoTitle}*\n` +
            `📺 *Channel:* ${channel}\n` +
            `👀 *Views:* ${viewCount}\n` +
            `👍 *Likes:* ${likes}\n` +
            `🎵 *Bitrate:* ${selectedAudio.abr || 'Auto'}kbps\n` +
            `📁 *Ukuran File:* ${(fs.statSync(audioPath).size / (1024 * 1024)).toFixed(2)} MB\n` +
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
    } finally {
        // Cleanup file
        try {
            if (audioPath && fs.existsSync(audioPath)) {
                fs.unlinkSync(audioPath);
                console.log(`[YTMP3] Cleaned up temp file: ${audioPath}`);
            }
        } catch (cleanupErr) {
            console.error('[YTMP3] Cleanup error:', cleanupErr);
        }
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
            return await downloadAudio(msg, bot, sessionData.url, buttonBitrate, usedPrefix, command);
        } else {
            console.log(`[YTMP3] No session data found for ${msg.sender}`);
            console.log(`[YTMP3] Available sessions:`, Object.keys(global.ytmp3Sessions || {}));
            return msg.reply("❌ Session expired. Silakan kirim ulang URL YouTube.");
        }
    }

    // Validasi URL normal (simple check)
    if (!input || !input.includes('youtube.com') && !input.includes('youtu.be')) {
      console.log(`[YTMP3] Invalid URL provided: "${input}"`);
      return msg.reply("❌ Masukkan URL YouTube yang valid.\n\nContoh: `.ytmp3 https://youtu.be/dQw4w9WgXcQ`");
    }

    const url = input;
    console.log(`[YTMP3] Processing URL: ${url}`);

    try {
        await msg.react("⏳");
        const { metadata, audioFormats } = await getYtInfo(url);
        const videoTitle = metadata.title;
        const thumbnailUrl = metadata.thumbnail;

        console.log(`[YTMP3] Got video info: "${videoTitle}"`);
        console.log(`[YTMP3] Available audio formats: ${audioFormats.length}`);

        // Jika bitrate sudah dipilih langsung
        if (bitrate) {
            console.log(`[YTMP3] Direct bitrate specified: ${bitrate}`);
            return await downloadAudio(msg, bot, url, bitrate, usedPrefix, command);
        }

        // Tampilkan pilihan bitrate
        const uniqueBitrates = [...new Set(audioFormats.map(f => f.abr).filter(Boolean))].sort((a, b) => b - a);
        console.log(`[YTMP3] Available bitrates:`, uniqueBitrates);
        
        if (uniqueBitrates.length === 0) {
            return msg.reply("❌ Tidak ada pilihan kualitas audio yang tersedia untuk link ini.");
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
        if (!global.ytmp3Sessions) global.ytmp3Sessions = {};
        global.ytmp3Sessions[msg.sender] = {
            url: url,
            timestamp: Date.now()
        };

        console.log(`[YTMP3] Session created for ${msg.sender} with URL: ${url}`);

        // Buat button dengan format yang mudah dideteksi (maksimal 3 opsi)
        const buttons = uniqueBitrates.slice(0, 3).map(bitrate => ({
            buttonId: `yt_audio_${bitrate}kbps`,
            buttonText: { displayText: `Download Audio ${Math.round(bitrate)}kbps` },
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
            footer: "Powered by 『∂αуℓιgнт』's Bot",
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