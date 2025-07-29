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

// --- FUNGSI PENCARIAN BARU MENGGUNAKAN API PUBLIK ---
async function searchPinterest(query) {
    try {
        const { data } = await axios.get(
            `https://www.pinterest.com/resource/BaseSearchResource/get/?source_url=/search/pins/?q=${encodeURIComponent(query)}&data={"options":{"scope":"pins","query":"${query}"}}`
        );
        const results = data.resource_response?.data?.results;
        if (!results || results.length === 0) {
            return [];
        }
        // Ambil URL gambar dengan resolusi tertinggi ('originals')
        return results.map(item => item.images.orig.url).filter(Boolean);
    } catch (error) {
        console.error("Pinterest API Error:", error);
        throw new Error("Gagal mengambil data dari API Pinterest. Coba lagi nanti.");
    }
}

// --- LOGIKA UTAMA PERINTAH BOT ---
module.exports = {
    name: "pin",
    alias: ["pinterest"],
    description: "Mencari gambar dari Pinterest.",
    category: "tools",
    execute: async (msg, { bot, args, usedPrefix, command }) => {
        if (!args.length || args.includes('-v')) { // Nonaktifkan video untuk sementara
            const helpMessage = `*Pencarian Pinterest* 🔎\n\nFitur ini digunakan untuk mencari gambar dari Pinterest.\n\n*Cara Penggunaan:*\n\`${usedPrefix + command} <query>\`\nContoh: \`${usedPrefix + command} cyberpunk city\`\n\n*Opsi Tambahan:*\n- \`-j <jumlah>\`: Untuk mengirim beberapa hasil sekaligus (maksimal 5).\n  Contoh: \`${usedPrefix + command} cat -j 3\`\n\n*(Pencarian video saat ini tidak tersedia)*`;
            return bot.sendMessage(msg.from, { text: helpMessage }, { quoted: msg });
        }

        let query = [];
        let count = 1;

        for (let i = 0; i < args.length; i++) {
            if (args[i].toLowerCase() === '-j') {
                count = parseInt(args[i + 1], 10) || 1;
                count = Math.min(Math.max(1, count), 5);
                i++;
            } else {
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
                    // Kirim gambar langsung dari URL
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