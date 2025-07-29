const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

// --- FUNGSI HELPER ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 200;
      const scrollMax = 5000;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollMax) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// --- FUNGSI UTAMA SCRAPING & DOWNLOAD ---

async function getPinterestLinks(keyword, type = 'image') {
  let browser;
  try {
    const executablePath = fs.existsSync('/usr/bin/chromium-browser') 
      ? '/usr/bin/chromium-browser' 
      : undefined;

    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    const page = await browser.newPage();
    const query = encodeURIComponent(keyword);
    const url = `https://id.pinterest.com/search/pins/?q=${query}`;

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle2' });
    await autoScroll(page);

    let results = [];
    if (type === 'image') {
      results = await page.evaluate(() => {
        const images = Array.from(document.querySelectorAll('img[src*="i.pinimg.com"]'));
        const imageUrls = images.map(img => img.src.replace(/(\/\d+x\/)/, '/originals/'));
        return [...new Set(imageUrls)];
      });
    } else if (type === 'video') {
      results = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href*="/pin/"]'));
        return [...new Set(anchors.map(a => 'https://www.pinterest.com' + a.getAttribute('href'))) ];
      });
    }
    
    await browser.close();
    return results;

  } catch (error) {
    console.error("Error saat scraping dengan Puppeteer:", error);
    if (browser) await browser.close();
    return [];
  }
}

// <<-- FUNGSI BARU UNTUK MENGUNDUH GAMBAR -->>
async function downloadImage(imageUrl) {
    let browser;
    try {
        const executablePath = fs.existsSync('/usr/bin/chromium-browser') ? '/usr/bin/chromium-browser' : undefined;
        browser = await puppeteer.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
        const page = await browser.newPage();
        
        // Meniru permintaan dari Pinterest untuk menghindari 403 Forbidden
        await page.setExtraHTTPHeaders({
            'Referer': 'https://www.pinterest.com/'
        });

        const response = await page.goto(imageUrl, { waitUntil: 'networkidle2' });
        const buffer = await response.buffer();
        
        await browser.close();
        return buffer;
    } catch (error) {
        console.error(`Gagal mengunduh gambar dari ${imageUrl}:`, error);
        if (browser) await browser.close();
        return null;
    }
}


async function downloadViaPintodown(pinUrl) {
  let browser;
  try {
    const executablePath = fs.existsSync('/usr/bin/chromium-browser') ? '/usr/bin/chromium-browser' : undefined;
    browser = await puppeteer.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    
    await page.goto('https://pintodown.com/', { waitUntil: 'domcontentloaded' });

    await page.type('#pinterest_video_url', pinUrl);
    await page.click('button.pinterest__button--download');

    await page.waitForSelector('a[href$=".mp4"]', { timeout: 15000 });
    const videoUrl = await page.evaluate(() => document.querySelector('a[href$=".mp4"]').href);

    await browser.close();
    return videoUrl;

  } catch (err) {
    console.error(`❌ Gagal unduh video dari ${pinUrl}: ${err.message}`);
    if (browser) await browser.close();
    return null;
  }
}

// --- LOGIKA UTAMA PERINTAH BOT ---

module.exports = {
  name: "pin",
  alias: ["pinterest"],
  description: "Mencari gambar dari Pinterest.",
  category: "tools",
  execute: async (msg, { bot, args, usedPrefix, command }) => {
    // ... (Kode untuk help message dan parsing args tetap sama) ...
    if (!args.length) {
      const helpMessage = `*Pencarian Pinterest* 🔎\n\nFitur ini digunakan untuk mencari media dari Pinterest.\n\n*Cara Penggunaan:*\n\`${usedPrefix + command} <query>\`\nContoh: \`${usedPrefix + command} cyberpunk city\`\n\n*Opsi Tambahan:*\n- \`-j <jumlah>\`: Untuk mengirim beberapa hasil sekaligus (maksimal 5).\n  Contoh: \`${usedPrefix + command} cat -j 3\`\n\n- \`-v\`: Untuk mencari video.\n  Contoh: \`${usedPrefix + command} nature timelapse -v\``;
      return bot.sendMessage(msg.from, { text: helpMessage }, { quoted: msg });
    }

    let query = [];
    let count = 1;
    let searchVideos = false;

    for (let i = 0; i < args.length; i++) {
      if (args[i].toLowerCase() === '-j') {
        count = parseInt(args[i + 1], 10) || 1;
        count = Math.min(Math.max(1, count), 5);
        i++;
      } else if (args[i].toLowerCase() === '-v') {
        searchVideos = true;
      } else {
        query.push(args[i]);
      }
    }
    const searchQuery = query.join(' ');
    if (!searchQuery) return msg.reply("Mohon masukkan query pencarian.");

    try {
      await msg.react("⏳");
      const searchType = searchVideos ? 'video' : 'image';
      
      const results = await getPinterestLinks(searchQuery, searchType);

      if (!results || results.length === 0) {
        await msg.react("❌");
        return msg.reply("Maaf, tidak ada hasil yang ditemukan. Coba dengan kata kunci lain.");
      }
      
      const itemsToSend = shuffleArray(results).slice(0, count);

      for (const item of itemsToSend) {
        if (searchType === 'image') {
          const imageBuffer = await downloadImage(item);
          if (imageBuffer) {
              await bot.sendMessage(msg.from, { image: imageBuffer, caption: `Hasil pencarian untuk: *${searchQuery}*` }, { quoted: msg });
          } else {
              await msg.reply(`Gagal mengunduh gambar dari salah satu link.`);
          }
        } else if (searchType === 'video') {
            msg.reply(`Mencoba mengunduh video dari: ${item}\nMohon tunggu sebentar...`);
            const videoUrl = await downloadViaPintodown(item);
            if (videoUrl) {
                await bot.sendMessage(msg.from, { video: { url: videoUrl }, caption: `Video *${searchQuery}* berhasil diunduh.` }, { quoted: msg });
            } else {
                msg.reply(`Gagal mengunduh video dari link tersebut.`);
            }
        }
        await sleep(1500);
      }

      await msg.react("✅");

    } catch (error) {
      console.error("Error pada perintah Pinterest:", error);
      await msg.react("❌");
      msg.reply("Terjadi kesalahan saat memproses permintaan Anda.");
    }
  },
};