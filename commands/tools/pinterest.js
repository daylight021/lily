const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

// --- FUNGSI HELPER ---

// Scroll minimal untuk kecepatan
async function quickScroll(page) {
  try {
    await page.evaluate(() => {
      // Scroll cepat sekali saja untuk mendapatkan ~10-15 gambar
      window.scrollTo(0, window.innerHeight * 2);
    });
    
    // Wait singkat untuk loading
    await new Promise(resolve => setTimeout(resolve, 1500));
  } catch (error) {
    console.log('⚠️ Warning scroll:', error.message);
  }
}

// Fungsi untuk mengacak array
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Fungsi untuk mendapatkan URL resolusi tinggi
function getHighResUrl(url) {
  return url
    .replace(/\/\d+x\d*\//, '/originals/')
    .replace(/236x/g, '736x')
    .replace(/474x/g, '736x');
}

// Fungsi untuk menambahkan randomness pada pencarian
function addRandomness(keyword) {
  const randomSuffixes = ['', ' aesthetic', ' beautiful', ' art', ' design', ' style'];
  const randomPrefix = ['', 'best ', 'cool ', 'amazing '];
  
  // Gunakan timestamp sebagai seed untuk konsistensi per request
  const seed = Date.now();
  const suffixIndex = seed % randomSuffixes.length;
  const prefixIndex = Math.floor(seed / 1000) % randomPrefix.length;
  
  return randomPrefix[prefixIndex] + keyword + randomSuffixes[suffixIndex];
}

// --- FUNGSI UTAMA SCRAPING ---

async function getPinterestImages(keyword) {
  let browser;
  try {
    const executablePath = fs.existsSync('/usr/bin/chromium-browser') 
      ? '/usr/bin/chromium-browser' 
      : undefined;

    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
        '--disable-web-security'
      ]
    });

    const page = await browser.newPage();
    
    // Viewport kecil untuk kecepatan
    await page.setViewport({ width: 1024, height: 768 });
    
    // Tambahkan randomness pada keyword untuk hasil berbeda
    const randomizedKeyword = addRandomness(keyword);
    const query = encodeURIComponent(randomizedKeyword);
    const url = `https://id.pinterest.com/search/pins/?q=${query}`;

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    console.log(`🔍 Mengakses: ${url}`);
    await page.goto(url, { 
      waitUntil: 'domcontentloaded', // Lebih cepat dari networkidle
      timeout: 15000 
    });

    // Wait minimal untuk loading awal
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Quick scroll - hanya 1 kali untuk mendapatkan beberapa gambar
    await quickScroll(page);

    const results = await page.evaluate(() => {
      // Selector sederhana untuk kecepatan
      const images = document.querySelectorAll('img[src*="i.pinimg.com"]');
      
      const imageUrls = Array.from(images)
        .map(img => img.src)
        .filter(src => src && src.includes('i.pinimg.com'))
        .filter(src => !src.includes('avatar')) // Skip avatars
        .map(src => {
          // Upgrade ke resolusi tinggi
          return src
            .replace(/\/\d+x\d*\//, '/originals/')
            .replace(/236x/g, '736x')
            .replace(/474x/g, '736x');
        });
      
      // Remove duplicates
      return [...new Set(imageUrls)];
    });
    
    console.log(`✅ Ditemukan ${results.length} gambar`);
    await browser.close();
    
    // Shuffle hasil untuk randomness
    return shuffleArray(results);

  } catch (error) {
    console.error("❌ Error saat scraping:", error.message);
    if (browser) await browser.close();
    return [];
  }
}

// Fungsi sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- MODUL UTAMA ---
module.exports = {
  name: "pin",
  alias: ["pinterest"],
  description: "Mencari gambar dari Pinterest dengan kualitas tinggi dan hasil random.",
  category: "tools",
  execute: async (msg, { bot, args, usedPrefix, command }) => {
    if (!args.length) {
      const helpMessage = `*📌 Pinterest Search* 

Mencari gambar berkualitas tinggi dari Pinterest.

*Penggunaan:*
\`${usedPrefix + command} <query>\`
Contoh: \`${usedPrefix + command} aesthetic wallpaper\`

*Opsi:*
• \`-j <jumlah>\`: Kirim beberapa hasil (maks 5)
  Contoh: \`${usedPrefix + command} cat -j 3\`

• \`-hd\`: Kirim gambar kualitas HD (sebagai dokumen)
  Contoh: \`${usedPrefix + command} wallpaper -hd\`

*Fitur:*
✨ Hasil selalu random setiap pencarian
🚀 Pencarian super cepat (~3-5 detik)
🎯 Gambar berkualitas tinggi

*Tips:*
• Gunakan kata kunci bahasa Inggris
• Semakin spesifik, semakin baik hasilnya`;
      
      return bot.sendMessage(msg.from, { text: helpMessage }, { quoted: msg });
    }

    let query = [];
    let count = 1;
    let hdMode = false;

    // Parse arguments
    for (let i = 0; i < args.length; i++) {
      if (args[i].toLowerCase() === '-j') {
        count = parseInt(args[i + 1], 10) || 1;
        count = Math.min(Math.max(1, count), 5);
        i++;
      } else if (args[i].toLowerCase() === '-hd') {
        hdMode = true;
      } else {
        query.push(args[i]);
      }
    }
    
    const searchQuery = query.join(' ');
    if (!searchQuery) return msg.reply("❌ Mohon masukkan query pencarian.");

    try {
      await msg.react("🔍");
      console.log(`🚀 Memulai pencarian: "${searchQuery}"`);
      
      const startTime = Date.now();
      const results = await getPinterestImages(searchQuery);
      const searchTime = ((Date.now() - startTime) / 1000).toFixed(1);

      if (!results || results.length === 0) {
        await msg.react("❌");
        return msg.reply(`❌ Tidak ada hasil ditemukan untuk "${searchQuery}". Coba kata kunci lain.`);
      }

      console.log(`⚡ Pencarian selesai dalam ${searchTime}s, ditemukan ${results.length} hasil`);
      
      // Ambil hasil random (sudah di-shuffle di function)
      const itemsToSend = results.slice(0, count);
      await msg.react("📤");

      // Kirim hasil
      for (let i = 0; i < itemsToSend.length; i++) {
        const item = itemsToSend[i];
        
        try {
          const caption = count > 1 ? 
            `📌 *${searchQuery}* (${i + 1}/${count})\n🔍 Pencarian: ${searchTime}s\n🎲 Hasil random` : 
            `📌 Hasil pencarian: *${searchQuery}*\n🔍 Waktu: ${searchTime}s\n🎲 Hasil random`;
          
          if (hdMode) {
            // Mode HD: Kirim sebagai dokumen untuk kualitas penuh
            try {
              const response = await axios.head(item, { timeout: 5000 });
              const contentLength = parseInt(response.headers['content-length'] || '0');
              const fileSize = (contentLength / (1024 * 1024)).toFixed(2);
              
              if (contentLength < 64 * 1024 * 1024) {
                await bot.sendMessage(msg.from, {
                  document: { url: item },
                  fileName: `Pinterest_${searchQuery.replace(/[^a-zA-Z0-9]/g, '_')}_HD_${Date.now()}.jpg`,
                  mimetype: 'image/jpeg',
                  caption: caption + `\n\n🎯 *Mode HD* (${fileSize}MB)\n💡 Buka sebagai file untuk kualitas penuh`
                }, { quoted: msg });
              } else {
                await bot.sendMessage(msg.from, { 
                  image: { url: item }, 
                  caption: caption + '\n\n⚠️ File terlalu besar untuk mode HD',
                  viewOnce: false
                }, { quoted: msg });
              }
            } catch (headError) {
              await bot.sendMessage(msg.from, {
                document: { url: item },
                fileName: `Pinterest_${searchQuery.replace(/[^a-zA-Z0-9]/g, '_')}_HD_${Date.now()}.jpg`,
                mimetype: 'image/jpeg',
                caption: caption + '\n\n🎯 *Mode HD*\n💡 Buka sebagai file untuk kualitas penuh'
              }, { quoted: msg });
            }
          } else {
            // Mode normal: Kirim sebagai gambar
            await bot.sendMessage(msg.from, { 
              image: { url: item }, 
              caption,
              viewOnce: false,
              jpegQuality: 95
            }, { quoted: msg });
          }
          
          // Jeda antar pengiriman
          if (i < itemsToSend.length - 1) {
            await sleep(800);
          }
          
        } catch (sendError) {
          console.error(`❌ Error mengirim item ${i + 1}:`, sendError.message);
          await msg.reply(`❌ Gagal mengirim hasil ${i + 1}/${count}`);
        }
      }

      await msg.react("✅");
      console.log(`✅ Selesai mengirim ${itemsToSend.length} hasil untuk "${searchQuery}"`);

    } catch (error) {
      console.error("❌ Error pada Pinterest command:", error);
      await msg.react("❌");
      msg.reply("❌ Terjadi kesalahan saat memproses permintaan. Silakan coba lagi.");
    }
  },
};