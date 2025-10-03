const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

// --- FUNGSI HELPER ---

// Scroll minimal untuk kecepatan (untuk pencarian)
async function quickScroll(page) {
  try {
    await page.evaluate(() => {
      window.scrollTo(0, window.innerHeight * 2);
    });
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

// Fungsi sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- FUNGSI SCRAPING ---

/**
 * [YANG DIPERBAIKI] Fungsi untuk mengunduh media dari satu URL Pinterest.
 * @param {string} url - URL pin Pinterest (gambar atau video).
 * @returns {Promise<{type: 'video'|'image', url: string}|null>}
 */
async function downloadFromPinterestURL(url) {
  let browser;
  try {
    const executablePath = fs.existsSync('/usr/bin/chromium-browser') ?
      '/usr/bin/chromium-browser' :
      undefined;

    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Menunggu selector utama dari gambar atau video muncul
    await page.waitForSelector('div[data-test-id="pin-closeup-image"] img, video[src]', { timeout: 10000 });

    const mediaData = await page.evaluate(() => {
      try {
        // Metode BARU: Cari data JSON yang tersembunyi di halaman
        const jsonDataEl = document.querySelector('script[id="__PWS_INITIAL_STATE__"]');
        if (jsonDataEl && jsonDataEl.textContent) {
          const data = JSON.parse(jsonDataEl.textContent);
          // Cari data pin di dalam struktur JSON yang kompleks
          const pinData = Object.values(data.resources.PinResource).find(
            (obj) => obj && obj.data && (obj.data.videos || obj.data.images)
          );

          if (pinData && pinData.data.videos) {
            const videoList = pinData.data.videos.video_list;
            // Pilih kualitas video terbaik (prioritas 720p)
            const videoUrl = videoList.V_720P?.url || videoList.V_480P?.url;
            if (videoUrl) {
              return { type: 'video', url: videoUrl };
            }
          }
        }
      } catch (e) {
        console.error('Gagal parsing JSON, mencoba metode fallback.', e);
      }

      // Metode LAMA (Fallback): Jika JSON gagal, coba cari elemen gambar
      const imageElement = document.querySelector('div[data-test-id="pin-closeup-image"] img');
      if (imageElement && imageElement.src) {
        const highResUrl = imageElement.src.replace(/(\/\d+x[^\/]*\/)/, '/originals/');
        return { type: 'image', url: highResUrl };
      }
      return null;
    });

    await browser.close();
    return mediaData;

  } catch (error) {
    console.error("❌ Error saat mengunduh dari URL:", error.message);
    if (browser) await browser.close();
    return null;
  }
}


/**
 * Fungsi untuk mencari dan scraping gambar dari keyword.
 * @param {string} keyword - Kata kunci pencarian.
 * @returns {Promise<string[]>}
 */
async function getPinterestImages(keyword) {
  let browser;
  try {
    const executablePath = fs.existsSync('/usr/bin/chromium-browser') ?
      '/usr/bin/chromium-browser' :
      undefined;

    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas',
        '--no-first-run', '--no-zygote', '--single-process', '--disable-gpu', '--disable-web-security'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({
      width: 640,
      height: 360
    });
    const query = encodeURIComponent(keyword);
    const url = `https://id.pinterest.com/search/pins/?q=${query}`;

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    console.log(`🔍 Mengakses: ${url}`);
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });
    await new Promise(resolve => setTimeout(resolve, 2000));
    await quickScroll(page);

    const results = await page.evaluate(() => {
      const images = document.querySelectorAll('img[src*="i.pinimg.com"]');
      const imageUrls = Array.from(images)
        .map(img => img.src)
        .filter(src => src && src.includes('i.pinimg.com'))
        .filter(src => !src.includes('avatar'))
        .map(src => {
          return src
            .replace(/\/\d+x\d*\//, '/originals/')
            .replace(/236x/g, '736x')
            .replace(/474x/g, '736x');
        });
      return [...new Set(imageUrls)];
    });

    console.log(`✅ Ditemukan ${results.length} gambar`);
    await browser.close();
    return shuffleArray(results);

  } catch (error) {
    console.error("❌ Error saat scraping:", error.message);
    if (browser) await browser.close();
    return [];
  }
}

// --- MODUL UTAMA ---
module.exports = {
  name: "pin",
  alias: ["pinterest"],
  description: "Mencari atau mengunduh media dari Pinterest.",
  category: "tools",
  execute: async (msg, {
    bot,
    args,
    usedPrefix,
    command
  }) => {
    if (!args.length) {
      const helpMessage = `*📌 Pinterest Search & Downloader* Mencari gambar berkualitas tinggi atau mengunduh media (video/gambar) dari URL Pinterest.

*1. Mode Pencarian:*
\`${usedPrefix + command} <query>\`
Contoh: \`${usedPrefix + command} aesthetic wallpaper\`

  *Opsi Pencarian:*
  • \`-j <jumlah>\`: Kirim beberapa hasil (maks 5)
    Contoh: \`${usedPrefix + command} cat -j 3\`
  • \`-hd\`: Kirim gambar kualitas HD (dokumen)
    Contoh: \`${usedPrefix + command} nature -hd\`

*2. Mode Pengunduh:*
\`${usedPrefix + command} <url_pinterest>\`
Contoh: \`${usedPrefix + command} https://id.pinterest.com/pin/123456789/\`

*Fitur:*
✨ Hasil pencarian selalu random
🚀 Proses cepat dan efisien
🎯 Mendukung download video & gambar dari URL`;

      return bot.sendMessage(msg.from, {
        text: helpMessage
      }, {
        quoted: msg
      });
    }

    const firstArg = args[0];
    const isUrl = firstArg.includes("pinterest.com/pin/");

    // --- LOGIKA BARU: JIKA INPUT ADALAH URL ---
    if (isUrl) {
      try {
        await msg.react("📥");
        console.log(`🚀 Memulai unduhan dari URL: "${firstArg}"`);

        const mediaData = await downloadFromPinterestURL(firstArg);

        if (!mediaData || !mediaData.url) {
          await msg.react("❌");
          return msg.reply("❌ Gagal mendapatkan media dari URL tersebut. Pastikan URL valid dan pin tidak bersifat privat.");
        }

        const caption = `✅ Berhasil diunduh dari Pinterest!`;

        if (mediaData.type === 'video') {
          await bot.sendMessage(msg.from, {
            video: {
              url: mediaData.url
            },
            caption
          }, {
            quoted: msg
          });
        } else { // 'image'
          await bot.sendMessage(msg.from, {
            image: {
              url: mediaData.url
            },
            caption
          }, {
            quoted: msg
          });
        }

        await msg.react("✅");
        console.log(`✅ Selesai mengirim media dari URL.`);
        return; // Hentikan eksekusi setelah berhasil mengunduh

      } catch (error) {
        console.error("❌ Error pada Pinterest URL command:", error);
        await msg.react("❌");
        return msg.reply("❌ Terjadi kesalahan saat memproses URL. Silakan coba lagi.");
      }
    }

    // --- LOGIKA LAMA: JIKA INPUT ADALAH QUERY PENCARIAN ---
    let query = [];
    let count = 1;
    let hdMode = false;

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
      const itemsToSend = results.slice(0, count);
      await msg.react("📤");

      for (let i = 0; i < itemsToSend.length; i++) {
        const item = itemsToSend[i];
        try {
          const caption = count > 1 ?
            `📌 *${searchQuery}* (${i + 1}/${count})\n🔍 Pencarian: ${searchTime}s` :
            `📌 Hasil pencarian: *${searchQuery}*\n🔍 Waktu: ${searchTime}s`;

          if (hdMode) {
            await bot.sendMessage(msg.from, {
              document: {
                url: item
              },
              fileName: `Pinterest_${searchQuery.replace(/[^a-zA-Z0-9]/g, '_')}_HD.jpg`,
              mimetype: 'image/jpeg',
              caption: caption + `\n\n🎯 *Mode HD*`
            }, {
              quoted: msg
            });
          } else {
            await bot.sendMessage(msg.from, {
              image: {
                url: item
              },
              caption,
              jpegQuality: 95
            }, {
              quoted: msg
            });
          }

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
      console.error("❌ Error pada Pinterest search command:", error);
      await msg.react("❌");
      msg.reply("❌ Terjadi kesalahan saat memproses permintaan. Silakan coba lagi.");
    }
  },
};