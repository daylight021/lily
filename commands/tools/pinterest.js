const axios = require('axios');
const cheerio = require('cheerio');

// --- FUNGSI HELPER ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

async function searchPinterest(query) {
    try {
        const url = `https://id.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
        const { data } = await axios.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
            }
        });

        const $ = cheerio.load(data);
        // Menemukan data JSON yang tersembunyi di dalam tag script
        const searchData = $('script[data-test-id="initial-props"]').html();
        if (!searchData) {
            throw new Error("Tidak dapat menemukan data JSON di halaman Pinterest.");
        }
        
        const json = JSON.parse(searchData);
        // Menavigasi objek JSON untuk menemukan hasil pencarian
        const results = json.props.initialReduxState.results.resourceResponses[0].response.data.results;
        
        if (!results || results.length === 0) return [];
        
        const media = results.map(item => {
            // Cek apakah item adalah video atau gambar
            if (item.videos && item.videos.video_list.V_720P) {
                return {
                    type: 'video',
                    url: item.videos.video_list.V_720P.url
                };
            }
            // Ambil gambar dengan resolusi 'originals' (tertinggi)
            if (item.images.orig) {
                return {
                    type: 'image',
                    url: item.images.orig.url
                };
            }
            return null;
        }).filter(item => item !== null); // Hapus item yang tidak valid

        return media;

    } catch (error) {
        console.error("Error saat scraping Pinterest:", error);
        throw new Error("Gagal mengambil data dari Pinterest. Mungkin struktur halaman berubah.");
    }
}


// --- LOGIKA UTAMA PERINTAH BOT ---
module.exports = {
  name: "pin",
  alias: ["pinterest"],
  description: "Mencari gambar atau video dari Pinterest.",
  category: "tools",
  execute: async (msg, { bot, args, usedPrefix, command }) => {
    if (!args.length) {
      const helpMessage = `*Pencarian Pinterest* 🔎\n\nFitur ini digunakan untuk mencari media dari Pinterest.\n\n*Cara Penggunaan:*\n\`${usedPrefix + command} <query>\`\nContoh: \`${usedPrefix + command} cyberpunk city\`\n\n*Opsi Tambahan:*\n- \`-j <jumlah>\`: Untuk mengirim beberapa hasil sekaligus (maksimal 5).\n  Contoh: \`${usedPrefix + command} cat -j 3\`\n\n- \`-v\`: Untuk mencari video.\n  Contoh: \`${usedPrefix + command} nature timelapse -v\``;
      return bot.sendMessage(msg.from, { text: helpMessage }, { quoted: msg });
    }

    let query = [];
    let count = 1;
    let searchFor = 'image'; // Default mencari gambar

    for (let i = 0; i < args.length; i++) {
      if (args[i].toLowerCase() === '-j') {
        count = parseInt(args[i + 1], 10) || 1;
        count = Math.min(Math.max(1, count), 5);
        i++;
      } else if (args[i].toLowerCase() === '-v') {
        searchFor = 'video';
      } else {
        query.push(args[i]);
      }
    }
    const searchQuery = query.join(' ');
    if (!searchQuery) return msg.reply("Mohon masukkan query pencarian.");

    try {
      await msg.react("⏳");
      
      const allMedia = await searchPinterest(searchQuery);
      const filteredMedia = allMedia.filter(item => item.type === searchFor);

      if (!filteredMedia || filteredMedia.length === 0) {
        await msg.react("❌");
        return msg.reply(`Maaf, tidak ada hasil ${searchFor} yang ditemukan untuk "${searchQuery}".`);
      }
      
      const itemsToSend = shuffleArray(filteredMedia).slice(0, count);

      for (const item of itemsToSend) {
        try {
            if (item.type === 'image') {
                const imageBuffer = await axios.get(item.url, {
                    responseType: 'arraybuffer',
                    headers: { 'Referer': 'https://www.pinterest.com/' }
                });
                await bot.sendMessage(msg.from, { image: imageBuffer.data, caption: `Hasil pencarian untuk: *${searchQuery}*` }, { quoted: msg });
            } else if (item.type === 'video') {
                await bot.sendMessage(msg.from, { video: { url: item.url }, caption: `Video *${searchQuery}* berhasil ditemukan.` }, { quoted: msg });
            }
        } catch (downloadError) {
             console.error("Gagal mengirim media Pinterest:", downloadError);
             await msg.reply(`Gagal mengirim salah satu media.`);
        }
        await sleep(1500);
      }

      await msg.react("✅");

    } catch (error) {
      console.error("Error pada perintah Pinterest:", error);
      await msg.react("❌");
      msg.reply(error.message || "Terjadi kesalahan saat memproses permintaan Anda.");
    }
  },
};