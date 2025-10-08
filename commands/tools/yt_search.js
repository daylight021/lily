const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execAsync = promisify(exec);
const YT_DLP_PATH = path.join(__dirname, '../../bin/yt-dlp');

// Helper function untuk format durasi
function formatDuration(seconds) {
    if (!seconds) return 'N/A';
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
    return 'python3';
}

const PYTHON_CMD = getPythonCommand();

async function searchYouTube(query, maxResults = 5) {
    try {
        // Detect if yt-dlp is standalone binary or Python script
        let command;
        try {
            const { stdout: fileType } = await execAsync(`file "${YT_DLP_PATH}"`);
            if (fileType.includes('ELF') || fileType.includes('executable')) {
                command = `"${YT_DLP_PATH}" "ytsearch${maxResults}:${query}" --dump-json --flat-playlist --no-warnings`;
            } else {
                command = `${PYTHON_CMD} "${YT_DLP_PATH}" "ytsearch${maxResults}:${query}" --dump-json --flat-playlist --no-warnings`;
            }
        } catch (e) {
            command = `"${YT_DLP_PATH}" "ytsearch${maxResults}:${query}" --dump-json --flat-playlist --no-warnings`;
        }
        
        const { stdout } = await execAsync(command, { maxBuffer: 10 * 1024 * 1024 }); // 10MB buffer
        
        // Parse setiap line sebagai JSON
        const results = stdout
            .trim()
            .split('\n')
            .filter(line => line.trim())
            .map(line => {
                try {
                    return JSON.parse(line);
                } catch (e) {
                    return null;
                }
            })
            .filter(Boolean);
        
        return results;
    } catch (err) {
        throw new Error(`Search gagal: ${err.message}`);
    }
}

module.exports = {
  name: "ytsearch",
  alias: ["yts", "youtubesearch", "play"],
  description: "Cari video di YouTube.",
  execute: async (msg, { args, bot, usedPrefix, command }) => {
    const query = args.join(' ');

    if (!query) {
      return msg.reply(`❌ Masukkan kata kunci pencarian.\n\nContoh: \`${usedPrefix}${command} minecraft tutorial\``);
    }

    try {
        await msg.react("🔍");
        await msg.reply(`🔍 Mencari: *${query}*...\n\nMohon tunggu sebentar.`);
        
        console.log(`[YTSEARCH] Searching for: "${query}"`);
        const results = await searchYouTube(query, 10);
        
        if (results.length === 0) {
            await msg.react("❌");
            return msg.reply(`❌ Tidak ada hasil untuk: *${query}*`);
        }

        console.log(`[YTSEARCH] Found ${results.length} results`);

        // Format hasil pencarian
        let responseText = `🔍 *Hasil Pencarian YouTube*\n`;
        responseText += `📝 Query: *${query}*\n`;
        responseText += `📊 Ditemukan: ${results.length} video\n\n`;
        responseText += `─────────────────────\n\n`;

        results.forEach((video, index) => {
            const num = index + 1;
            const title = video.title || 'No Title';
            const channel = video.uploader || video.channel || 'Unknown';
            const duration = formatDuration(video.duration);
            const views = formatNumber(video.view_count);
            const url = `https://youtube.com/watch?v=${video.id}`;
            
            responseText += `*${num}. ${title}*\n`;
            responseText += `📺 Channel: ${channel}\n`;
            responseText += `⏱️ Duration: ${duration}\n`;
            responseText += `👀 Views: ${views}\n`;
            responseText += `🔗 ${url}\n\n`;
        });

        responseText += `─────────────────────\n`;
        responseText += `💡 *Cara Download:*\n`;
        responseText += `• Video: \`${usedPrefix}ytmp4 <url>\`\n`;
        responseText += `• Audio: \`${usedPrefix}ytmp3 <url>\``;

        await msg.reply(responseText);
        await msg.react("✅");

    } catch (err) {
      console.error("Proses ytsearch gagal:", err);
      await msg.react("⚠️");
      return msg.reply(`❌ Gagal mencari video.\n\n*Alasan:* ${err.message}`);
    }
  },
};