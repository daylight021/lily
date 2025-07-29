const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

// --- FUNGSI HELPER YANG DIOPTIMALKAN ---

// Scroll yang lebih efisien dan cepat (kompatibel semua versi Puppeteer)
async function smartScroll(page, maxScrolls = 3) {
  try {
    await page.evaluate(async (maxScrolls) => {
      await new Promise(resolve => {
        let scrollCount = 0;
        const distance = 1000; // Scroll lebih besar per step
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          const currentScroll = window.pageYOffset + window.innerHeight;
          
          window.scrollBy(0, distance);
          scrollCount++;
          
          // Stop jika sudah mencapai bottom atau max scroll
          if (currentScroll >= scrollHeight || scrollCount >= maxScrolls) {
            clearInterval(timer);
            resolve();
          }
        }, 800); // Interval lebih lama untuk loading
      });
    }, maxScrolls);
    
    // Wait for images to load (kompatibel dengan semua versi Puppeteer)
    await new Promise(resolve => setTimeout(resolve, 2000));
  } catch (error) {
    console.log('⚠️ Warning scroll:', error.message);
    // Fallback scroll sederhana jika error
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await new Promise(resolve => setTimeout(resolve, 1500));
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
  // Pinterest image URL patterns:
  // 236x = small, 474x = medium, 736x = large, originals = highest
  return url
    .replace(/\/\d+x\d*\//, '/originals/') // Coba original dulu
    .replace(/236x/g, '736x') // Fallback ke 736x
    .replace(/474x/g, '736x'); // Upgrade 474x ke 736x
}

// --- FUNGSI UTAMA SCRAPING YANG DIOPTIMALKAN ---

async function getPinterestLinks(keyword, type = 'image') {
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
        '--disable-web-security', // Tambahan untuk akses gambar
        '--disable-images=false' // Pastikan gambar dimuat
      ]
    });

    const page = await browser.newPage();
    
    // Set viewport yang lebih besar untuk mendapatkan lebih banyak konten
    await page.setViewport({ width: 1920, height: 1080 });
    
    const query = encodeURIComponent(keyword);
    const url = `https://id.pinterest.com/search/pins/?q=${query}`;

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    console.log(`🔍 Mengakses: ${url}`);
    await page.goto(url, { 
      waitUntil: 'networkidle0', // Wait sampai network idle
      timeout: 30000 
    });

    // Wait for Pinterest to load properly (kompatibel semua versi)
    try {
      await page.waitForSelector('[data-test-id="pin"]', { timeout: 10000 });
    } catch (e) {
      console.log('Selector utama tidak ditemukan, menunggu loading...');
      // Fallback wait
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // Smart scroll - hanya 2-3 kali scroll untuk mendapatkan ~20-30 gambar
    await smartScroll(page, 2);

    let results = [];
    
    if (type === 'image') {
      results = await page.evaluate(() => {
        // Selector yang lebih spesifik untuk mendapatkan gambar berkualitas
        const selectors = [
          'img[src*="i.pinimg.com"]',
          '[data-test-id="pin"] img',
          '.pinWrapper img',
          '.Pj7 img' // Pinterest class
        ];
        
        let allImages = [];
        
        // Coba semua selector
        selectors.forEach(selector => {
          const images = document.querySelectorAll(selector);
          allImages.push(...Array.from(images));
        });
        
        // Filter dan process URLs
        const imageUrls = allImages
          .map(img => img.src || img.dataset.src || img.getAttribute('src'))
          .filter(src => src && src.includes('i.pinimg.com'))
          .filter(src => !src.includes('avatar')) // Skip avatars
          .map(src => {
            // Upgrade ke resolusi tertinggi
            return src
              .replace(/\/\d+x\d*\//, '/originals/')
              .replace(/236x/g, '736x')
              .replace(/474x/g, '736x');
          });
        
        // Remove duplicates dan return
        return [...new Set(imageUrls)];
      });
      
      console.log(`✅ Ditemukan ${results.length} gambar`);
      
    } else if (type === 'video') {
      results = await page.evaluate(() => {
        const selectors = [
          'a[href*="/pin/"][data-test-id="pin"]',
          'a[href*="/pin/"]',
          '[data-test-id="pin"] a'
        ];
        
        let allLinks = [];
        selectors.forEach(selector => {
          const links = document.querySelectorAll(selector);
          allLinks.push(...Array.from(links));
        });
        
        const pinUrls = allLinks
          .map(a => a.href)
          .filter(href => href && href.includes('/pin/'))
          .map(href => href.split('?')[0]); // Remove query params
        
        return [...new Set(pinUrls)];
      });
      
      console.log(`✅ Ditemukan ${results.length} pin video`);
    }
    
    await browser.close();
    return results;

  } catch (error) {
    console.error("❌ Error saat scraping:", error.message);
    if (browser) await browser.close();
    return [];
  }
}

// Fungsi download video yang lebih robust
async function downloadViaPintodown(pinUrl) {
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
        '--disable-setuid-sandbox'
      ]
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    console.log(`📥 Mengunduh video dari: ${pinUrl}`);
    await page.goto('https://pintodown.com/', { waitUntil: 'domcontentloaded' });

    // Clear input dan masukkan URL
    await page.click('#pinterest_video_url');
    await page.keyboard.selectAll();
    await page.type('#pinterest_video_url', pinUrl);
    
    await page.click('button.pinterest__button--download');

    // Wait untuk link download dengan timeout lebih panjang
    await page.waitForSelector('a[href$=".mp4"], a[href*=".mp4"]', { timeout: 20000 });
    
    const videoUrl = await page.evaluate(() => {
      const link = document.querySelector('a[href$=".mp4"], a[href*=".mp4"]');
      return link ? link.href : null;
    });

    await browser.close();
    return videoUrl;

  } catch (err) {
    console.error(`❌ Gagal unduh video: ${err.message}`);
    if (browser) await browser.close();
    return null;
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
  description: "Mencari gambar atau video dari Pinterest dengan kualitas tinggi.",
  category: "tools",
  execute: async (msg, { bot, args, usedPrefix, command }) => {
    if (!args.length) {
      const helpMessage = `*📌 Pinterest Search* 

Mencari media berkualitas tinggi dari Pinterest.

*Penggunaan:*
\`${usedPrefix + command} <query>\`
Contoh: \`${usedPrefix + command} aesthetic wallpaper\`

*Opsi:*
• \`-j <jumlah>\`: Kirim beberapa hasil (maks 5)
  Contoh: \`${usedPrefix + command} cat -j 3\`

• \`-v\`: Cari video
  Contoh: \`${usedPrefix + command} cooking -v\`

• \`-hd\`: Kirim gambar kualitas HD (sebagai dokumen)
  Contoh: \`${usedPrefix + command} wallpaper -hd\`

*Tips untuk hasil terbaik:*
• Gunakan kata kunci bahasa Inggris
• Semakin spesifik, semakin baik hasilnya`;
      
      return bot.sendMessage(msg.from, { text: helpMessage }, { quoted: msg });
    }

    let query = [];
    let count = 1;
    let searchVideos = false;
    let hdMode = false; // Mode HD (kirim sebagai dokumen)

    // Parse arguments
    for (let i = 0; i < args.length; i++) {
      if (args[i].toLowerCase() === '-j') {
        count = parseInt(args[i + 1], 10) || 1;
        count = Math.min(Math.max(1, count), 5);
        i++;
      } else if (args[i].toLowerCase() === '-v') {
        searchVideos = true;
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
      console.log(`🚀 Memulai pencarian: "${searchQuery}" (${searchVideos ? 'video' : 'gambar'})`);
      
      const startTime = Date.now();
      const searchType = searchVideos ? 'video' : 'image';
      const results = await getPinterestLinks(searchQuery, searchType);
      const searchTime = ((Date.now() - startTime) / 1000).toFixed(1);

      if (!results || results.length === 0) {
        await msg.react("❌");
        return msg.reply(`❌ Tidak ada hasil ditemukan untuk "${searchQuery}". Coba kata kunci lain.`);
      }

      console.log(`⚡ Pencarian selesai dalam ${searchTime}s, ditemukan ${results.length} hasil`);
      
      const itemsToSend = shuffleArray(results).slice(0, count);
      await msg.react("📤");

      // Kirim hasil
      for (let i = 0; i < itemsToSend.length; i++) {
        const item = itemsToSend[i];
        
        try {
          if (searchType === 'image') {
            const caption = count > 1 ? 
              `📌 *${searchQuery}* (${i + 1}/${count})\n🔍 Pencarian: ${searchTime}s` : 
              `📌 Hasil pencarian: *${searchQuery}*\n🔍 Waktu: ${searchTime}s`;
            
            if (hdMode) {
              // Mode HD: Kirim sebagai dokumen untuk kualitas penuh
              try {
                const response = await axios.head(item, { timeout: 5000 });
                const contentLength = parseInt(response.headers['content-length'] || '0');
                const fileSize = (contentLength / (1024 * 1024)).toFixed(2); // MB
                
                // Cek ukuran file (maksimal 64MB untuk dokumen WA)
                if (contentLength < 64 * 1024 * 1024) {
                  await bot.sendMessage(msg.from, {
                    document: { url: item },
                    fileName: `Pinterest_${searchQuery.replace(/[^a-zA-Z0-9]/g, '_')}_HD_${Date.now()}.jpg`,
                    mimetype: 'image/jpeg',
                    caption: caption + `\n\n🎯 *Mode HD* (${fileSize}MB)\n💡 Buka sebagai file untuk kualitas penuh`
                  }, { quoted: msg });
                } else {
                  // File terlalu besar, kirim sebagai gambar biasa
                  await bot.sendMessage(msg.from, { 
                    image: { url: item }, 
                    caption: caption + '\n\n⚠️ File terlalu besar untuk mode HD',
                    viewOnce: false
                  }, { quoted: msg });
                }
              } catch (headError) {
                console.log('⚠️ Gagal cek ukuran file, menggunakan mode dokumen...');
                await bot.sendMessage(msg.from, {
                  document: { url: item },
                  fileName: `Pinterest_${searchQuery.replace(/[^a-zA-Z0-9]/g, '_')}_HD_${Date.now()}.jpg`,
                  mimetype: 'image/jpeg',
                  caption: caption + '\n\n🎯 *Mode HD*\n💡 Buka sebagai file untuk kualitas penuh'
                }, { quoted: msg });
              }
            } else {
              // Mode normal: Kirim sebagai gambar dengan optimasi
              await bot.sendMessage(msg.from, { 
                image: { url: item }, 
                caption,
                viewOnce: false,
                jpegQuality: 95 // Kualitas tinggi tapi tidak maksimal (untuk kecepatan)
              }, { quoted: msg });
            }
            
          } else if (searchType === 'video') {
            const downloadMsg = await msg.reply(`📥 Mengunduh video ${i + 1}/${count} dari Pinterest...\n⏳ Mohon tunggu sebentar...`);
            
            const videoUrl = await downloadViaPintodown(item);
            if (videoUrl) {
              await bot.sendMessage(msg.from, { 
                video: { url: videoUrl }, 
                caption: `🎥 Video *${searchQuery}* (${i + 1}/${count})` 
              }, { quoted: msg });
            } else {
              await msg.reply(`❌ Gagal mengunduh video ${i + 1}/${count}. Mencoba yang lain...`);
            }
          }
          
          // Jeda antar pengiriman
          if (i < itemsToSend.length - 1) {
            await sleep(1000);
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