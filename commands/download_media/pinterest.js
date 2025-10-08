const puppeteer = require('puppeteer'); 
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

// Cleanup temp folder saat module dimuat - HANYA file yang lebih dari 1 jam
(async () => {
  try {
    const tempDir = path.join(__dirname, '../../temp');
    if (await fs.pathExists(tempDir)) {
      const files = await fs.readdir(tempDir);
      const oneHourAgo = Date.now() - (60 * 60 * 1000); // 1 jam yang lalu
      
      for (const file of files) {
        if (file.startsWith('pinterest_')) {
          const filePath = path.join(tempDir, file);
          try {
            const stats = await fs.stat(filePath);
            // Hanya hapus file yang lebih dari 1 jam
            if (stats.mtimeMs < oneHourAgo) {
              await fs.unlink(filePath);
              console.log(`🧹 Cleanup file lama: ${file}`);
            }
          } catch (err) {
            // File mungkin sudah terhapus, skip
          }
        }
      }
    }
  } catch (e) {
    // Abaikan error saat cleanup
  }
})();

// --- FUNGSI HELPER ---

async function quickScroll(page) {
  try {
    await page.evaluate(() => window.scrollTo(0, window.innerHeight * 2));
    await new Promise(resolve => setTimeout(resolve, 1500));
  } catch (error) {
    console.log('⚠️ Warning scroll:', error.message);
  }
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- FUNGSI DOWNLOAD MENGGUNAKAN COBALT API ---

async function downloadViaCobalt(pinUrl) {
  console.log(`🚀 Menggunakan Cobalt API untuk ${pinUrl}`);
  let filepath = null;
  
  try {
    const cobaltApiUrl = 'http://localhost:9000/';
    
    const payload = {
      url: pinUrl,
      videoQuality: "max",
      filenameStyle: "basic",
      downloadMode: "auto"
    };
    
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    console.log('📤 Mengirim request ke Cobalt API...');
    
    // Mengirim request ke API
    const response = await axios.post(cobaltApiUrl, payload, { 
      headers, 
      timeout: 30000,
      validateStatus: (status) => status < 500 // Terima status 4xx untuk handling manual
    });
    
    const data = response.data;
    console.log('📥 Response dari Cobalt:', JSON.stringify(data, null, 2));

    // Memeriksa status respons dari Cobalt
    if (data.status === 'error') {
      throw new Error(`Cobalt API error: ${data.error?.code || 'Unknown error'}`);
    }
    
    if (data.status === 'rate-limit') {
      throw new Error('Rate limit tercapai. Tunggu beberapa saat.');
    }
    
    // Mendapatkan URL media dari response
    let mediaUrl = null;
    
    if (data.status === 'redirect' || data.status === 'tunnel') {
      mediaUrl = data.url;
    } else if (data.status === 'stream') {
      mediaUrl = data.url;
    } else if (data.url) {
      mediaUrl = data.url;
    }
    
    if (!mediaUrl) {
      throw new Error('API tidak mengembalikan URL media yang valid.');
    }

    console.log(`🔗 URL Media: ${mediaUrl.substring(0, 100)}...`);

    const dir = path.join(__dirname, '../../temp');
    await fs.ensureDir(dir);
    
    // Deteksi ekstensi file dari Content-Type atau URL
    let fileExt = '.mp4'; // Default
    
    // Cek ukuran file terlebih dahulu dengan HEAD request
    try {
      const headResponse = await axios.head(mediaUrl, { timeout: 10000 });
      const contentLength = parseInt(headResponse.headers['content-length'] || '0');
      const contentType = headResponse.headers['content-type'];
      
      // Cek ukuran file, jika > 50MB kemungkinan akan menyebabkan memory issue
      if (contentLength > 50 * 1024 * 1024) {
        console.log(`⚠️ File besar terdeteksi: ${(contentLength / (1024 * 1024)).toFixed(2)} MB`);
      }
      
      if (contentType) {
        if (contentType.includes('video')) fileExt = '.mp4';
        else if (contentType.includes('image/gif')) fileExt = '.gif';
        else if (contentType.includes('image/jpeg')) fileExt = '.jpg';
        else if (contentType.includes('image/png')) fileExt = '.png';
        else if (contentType.includes('image/webp')) fileExt = '.webp';
      }
    } catch (headError) {
      console.log('⚠️ HEAD request gagal, lanjut download:', headError.message);
    }
    
    const filename = `pinterest_${Date.now()}${fileExt}`;
    filepath = path.join(dir, filename);
    
    console.log(`💾 Mulai download ke: ${filepath}`);
    
    // Mengunduh file media dari URL yang didapatkan
    const mediaResponse = await axios({
      url: mediaUrl,
      method: 'GET',
      responseType: 'stream',
      timeout: 60000,
      maxRedirects: 5,
      maxContentLength: 100 * 1024 * 1024, // Max 100MB
      maxBodyLength: 100 * 1024 * 1024
    });
    
    const writer = fs.createWriteStream(filepath);
    mediaResponse.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', async () => {
        // Tunggu sebentar untuk memastikan file sudah ter-flush ke disk
        await sleep(500);
        
        // Verifikasi file benar-benar ada dan readable
        try {
          const stats = await fs.stat(filepath);
          console.log(`✅ Media disimpan: ${filepath} (${(stats.size / 1024).toFixed(2)} KB)`);
          resolve(filepath);
        } catch (statError) {
          console.error('❌ File gagal disimpan dengan benar:', statError);
          reject(new Error('File tidak dapat diverifikasi setelah download'));
        }
      });
      
      writer.on('error', async (err) => {
        console.error('❌ Error saat menulis file:', err);
        // Hapus file jika error
        if (filepath) {
          await fs.unlink(filepath).catch(() => {});
        }
        reject(err);
      });
      
      // Handle error dari stream download
      mediaResponse.data.on('error', async (err) => {
        console.error('❌ Error saat streaming data:', err);
        writer.close();
        if (filepath) {
          await fs.unlink(filepath).catch(() => {});
        }
        reject(err);
      });
    });

  } catch (error) {
    // Cleanup file jika ada error
    if (filepath) {
      await fs.unlink(filepath).catch(() => {});
    }
    
    if (error.response) {
      console.error(`❌ Gagal unduh via Cobalt: Status ${error.response.status}`, error.response.data);
    } else {
      console.error(`❌ Gagal unduh via Cobalt: ${error.message}`);
    }
    return null;
  }
}

// --- FUNGSI SEARCH PINTEREST ---

async function getPinterestImages(keyword) {
  let browser;
  try {
    const executablePath = fs.existsSync('/usr/bin/chromium-browser') ?
      '/usr/bin/chromium-browser' : undefined;
      
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    const page = await browser.newPage();
    const query = encodeURIComponent(keyword);
    const url = `https://id.pinterest.com/search/pins/?q=${query}`;
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log(`🔍 Mengakses: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(2000);
    await quickScroll(page);
    
    const results = await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img[src*="i.pinimg.com"]'));
      return [...new Set(images.map(img => img.src.replace(/236x|474x|736x/, 'originals')))];
    });
    
    console.log(`✅ Ditemukan ${results.length} gambar`);
    return shuffleArray(results);
    
  } catch (error) {
    console.error("❌ Error saat scraping gambar:", error.message);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}

// --- MODUL UTAMA ---

module.exports = {
  name: "pin",
  alias: ["pinterest"],
  description: "Mencari atau mengunduh media dari Pinterest.",
  category: "tools",
  
  execute: async (msg, { bot, args, usedPrefix, command }) => {
    
    if (!args.length) {
      return msg.reply(`*📌 Pinterest Downloader & Search*
      
*1. Mode Unduh (Video/Gambar/GIF):*
\`${usedPrefix + command} <url_pinterest>\`
_Contoh:_ \`${usedPrefix + command} https://id.pinterest.com/pin/12345/\`

*2. Mode Cari (Gambar):*
\`${usedPrefix + command} <query>\`
_Contoh:_ \`${usedPrefix + command} cat aesthetic\`
• Tambahkan \`-j <jumlah>\` untuk hasil > 1 (maks 5)
• Tambahkan \`-hd\` untuk mengirim sebagai dokumen`);
    }

    const firstArg = args[0];
    const isUrl = firstArg.includes("pinterest.com/pin/");

    // === MODE DOWNLOAD URL ===
    if (isUrl) {
      let tempFile = null;
      try {
        await msg.react("🔥");
        
        console.log('🎬 Memulai download dari Pinterest...');
        
        // Memanggil fungsi download yang menggunakan Cobalt API
        tempFile = await downloadViaCobalt(firstArg);
        
        if (!tempFile) {
          await msg.react("❌");
          return msg.reply(
            "❌ Gagal mengunduh media dari URL tersebut.\n\n" +
            "*Kemungkinan penyebab:*\n" +
            "• URL tidak valid atau pin bersifat privat\n" +
            "• Layanan Cobalt sedang down/error\n" +
            "• Media tidak didukung oleh Cobalt\n" +
            "• Instance Cobalt tidak berjalan di localhost:9000"
          );
        }
        
        // Verifikasi file ada dan bisa dibaca
        const fileExists = await fs.pathExists(tempFile);
        if (!fileExists) {
          console.error('❌ File tidak ditemukan setelah download:', tempFile);
          await msg.react("❌");
          return msg.reply("❌ File berhasil diunduh tetapi hilang. Bot mungkin restart. Coba lagi.");
        }
        
        const fileStats = await fs.stat(tempFile);
        const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);
        
        console.log(`📊 File info: ${fileSizeMB} MB, Path: ${tempFile}`);
        
        if (fileStats.size > 16 * 1024 * 1024) {
          await fs.unlink(tempFile).catch(() => {});
          return msg.reply(`❌ File terlalu besar (${fileSizeMB} MB). WhatsApp hanya mengizinkan maks ~16 MB untuk video.`);
        }
        
        console.log('📖 Membaca file untuk dikirim...');
        const mediaBuffer = await fs.readFile(tempFile);
        const fileExt = path.extname(tempFile).toLowerCase();

        console.log(`📤 Mengirim media (${fileExt}) ke WhatsApp...`);
        
        const caption = `✅ Berhasil diunduh!\n💾 Ukuran: ${fileSizeMB} MB`;

        // Deteksi apakah ini GIF berdasarkan URL atau ekstensi
        const isGifContent = firstArg.toLowerCase().includes('/gif/') || 
                            firstArg.toLowerCase().includes('giphy') ||
                            fileExt === '.gif';

        // Mengirim media berdasarkan ekstensinya
        if (isGifContent) {
            console.log('🎞️ Terdeteksi sebagai GIF, mengirim sebagai dokumen...');
            const fileName = `pinterest_gif_${Date.now()}.gif`;
            await bot.sendMessage(msg.from, { 
                document: mediaBuffer, 
                fileName: fileName,
                mimetype: 'image/gif',
                caption: caption
            }, { quoted: msg });
        } else if (['.mp4', '.mov', '.avi', '.mkv'].includes(fileExt)) {
            await bot.sendMessage(msg.from, { video: mediaBuffer, caption, mimetype: 'video/mp4' }, { quoted: msg });
        } else if (['.jpg', '.jpeg', '.png', '.webp'].includes(fileExt)) {
            await bot.sendMessage(msg.from, { image: mediaBuffer, caption, mimetype: 'image/jpeg' }, { quoted: msg });
        } else {
            // Fallback sebagai dokumen jika format tidak dikenal
            await bot.sendMessage(msg.from, { document: mediaBuffer, fileName: path.basename(tempFile), caption, mimetype: 'application/octet-stream' }, { quoted: msg });
        }
        
        console.log('✅ Media berhasil dikirim!');
        await msg.react("✅");

      } catch (error) {
        console.error("❌ Error pada perintah Pinterest URL:", error);
        await msg.react("❌");
        msg.reply(`❌ Terjadi kesalahan: ${error.message}`);
        
      } finally {
        if (tempFile) {
          setTimeout(async () => {
            try {
              if (await fs.pathExists(tempFile)) {
                await fs.unlink(tempFile);
                console.log('🗑️ Temp file berhasil dihapus');
              }
            } catch (err) {
              console.log('⚠️ Gagal hapus temp file:', err.message);
            }
          }, 2000); // Tunggu 2 detik sebelum hapus
        }
      }
      return;
    }

    // === MODE SEARCH ===
    const query = args.filter(arg => !['-j', '-hd'].includes(arg.toLowerCase()) && isNaN(arg)).join(' ');
    const countArgIndex = args.findIndex(arg => arg.toLowerCase() === '-j');
    let count = countArgIndex !== -1 ? parseInt(args[countArgIndex + 1]) : 1;
    count = Math.min(Math.max(1, count), 5); // Batasi antara 1 dan 5
    const hdMode = args.some(arg => arg.toLowerCase() === '-hd');

    if (!query) return msg.reply("❌ Mohon masukkan query pencarian.");

    try {
      await msg.react("🔎");
      const results = await getPinterestImages(query);
      if (!results || results.length === 0) {
        await msg.react("❌");
        return msg.reply(`❌ Tidak ada hasil gambar untuk "${query}".`);
      }
      
      await msg.react("📤");
      for (let i = 0; i < Math.min(count, results.length); i++) {
        const item = results[i];
        try {
          const caption = `📌 Hasil pencarian: *${query}*`;
          if (hdMode) {
            await bot.sendMessage(msg.from, { document: { url: item }, fileName: `${query.replace(/\s/g, '_')}_${i + 1}.jpg`, mimetype: 'image/jpeg', caption }, { quoted: msg });
          } else {
            await bot.sendMessage(msg.from, { image: { url: item }, caption }, { quoted: msg });
          }
          if (i < count - 1) await sleep(800);
        } catch (sendError) {
          console.error(`❌ Gagal mengirim item ${i + 1}:`, sendError.message);
          await msg.reply(`❌ Gagal mengirim hasil ke-${i + 1}.`);
        }
      }
      await msg.react("✅");
    } catch (error) {
      console.error("❌ Error pada perintah pencarian Pinterest:", error);
      await msg.react("❌");
      msg.reply("❌ Terjadi kesalahan saat mencari gambar.");
    }
  },
};