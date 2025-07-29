const axios = require('axios');

// --- FUNGSI HELPER ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// --- FUNGSI PENCARIAN BARU MENGGUNAKAN PINTEREST API ---
async function searchPinterest(query) {
    return new Promise(async (resolve, reject) => {
        try {
            const { data } = await axios.get('https://id.pinterest.com/search/pins/', {
                headers: { "Accept-Encoding": "gzip,deflate,br" },
                params: { q: query }
            });

            // Regex untuk menemukan URL API yang berisi data hasil pencarian
            const csrftoken = data.match(/csrftoken" value="([^"]+)"/)[1];
            const searchablePlData = data.match(/searchablePlClientSession" value="([^"]+)"/)[1];

            const requestData = {
                options: {
                    query: query,
                    scope: "pins",
                    page_size: 250 // Ambil lebih banyak hasil
                },
            };

            const finalUrl = `https://id.pinterest.com/resource/BaseSearchResource/get/?source_url=/search/pins/?q=${encodeURIComponent(query)}&data=${encodeURIComponent(JSON.stringify(requestData))}`;
            
            const response = await axios.get(finalUrl, {
                headers: {
                    "Accept": "application/json, text/javascript, */*, q=0.01",
                    "X-Requested-With": "XMLHttpRequest",
                    "X-CSRFToken": csrftoken,
                    "X-Bookmark": searchablePlData || "",
                    "Referer": `https://id.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`,
                }
            });

            const results = response.data.resource_response.data.results;
            if (!results || results.length === 0) {
                return resolve([]);
            }

            // Ekstrak hanya URL gambar resolusi tertinggi
            const imageUrls = results.map(item => item.images.orig.url).filter(Boolean);
            resolve(imageUrls);

        } catch (error) {
            console.error('Pinterest API Error:', error);
            reject(new Error("Gagal mengambil data dari API Pinterest."));
        }
    });
}


// --- LOGIKA UTAMA PERINTAH BOT ---
module.exports = {
  name: "pin",
  alias: ["pinterest"],
  description: "Mencari gambar atau video dari Pinterest.",
  category: "tools",
  execute: async (msg, { bot, args, usedPrefix, command }) => {
    if (!args.length) {
        const helpMessage = `*Pencarian Pinterest* 🔎\n\nFitur ini digunakan untuk mencari media dari Pinterest.\n\n*Cara Penggunaan:*\n\`${usedPrefix + command} <query>\`\nContoh: \`${usedPrefix + command} cyberpunk city\`\n\n*Opsi Tambahan:*\n- \`-j <jumlah>\`: Untuk mengirim beberapa hasil sekaligus (maksimal 5).\n  Contoh: \`${usedPrefix + command} cat -j 3\`\n\n*Catatan:* Pencarian video saat ini dinonaktifkan untuk stabilitas.`;
        return bot.sendMessage(msg.from, { text: helpMessage }, { quoted: msg });
    }

    let query = [];
    let count = 1;

    // Parsing args, video search (-v) untuk sementara tidak diaktifkan
    for (let i = 0; i < args.length; i++) {
        if (args[i].toLowerCase() === '-j') {
            count = parseInt(args[i + 1], 10) || 1;
            count = Math.min(Math.max(1, count), 5);
            i++;
        } else if (args[i].toLowerCase() === '-v') {
            return msg.reply("Maaf, pencarian video Pinterest sedang tidak tersedia saat ini.");
        } 
        else {
            query.push(args[i]);
        }
    }
    const searchQuery = query.join(' ');
    if (!searchQuery) return msg.reply("Mohon masukkan query pencarian.");

    try {
      await msg.react("⏳");
      
      const results = await searchPinterest(searchQuery);

      if (!results || results.length === 0) {
        await msg.react("❌");
        return msg.reply("Maaf, tidak ada hasil yang ditemukan. Coba dengan kata kunci lain.");
      }
      
      const itemsToSend = shuffleArray(results).slice(0, count);

      for (const itemUrl of itemsToSend) {
        try {
            await bot.sendMessage(msg.from, { image: { url: itemUrl }, caption: `Hasil pencarian untuk: *${searchQuery}*` }, { quoted: msg });
        } catch (sendError) {
             console.error("Gagal mengirim media Pinterest:", sendError);
             await msg.reply(`Gagal mengirim salah satu gambar.`);
        }
        await sleep(1000); // Jeda antar kiriman
      }

      await msg.react("✅");

    } catch (error) {
      console.error("Error pada perintah Pinterest:", error);
      await msg.react("❌");
      msg.reply(error.message || "Terjadi kesalahan saat memproses permintaan Anda.");
    }
  },
};