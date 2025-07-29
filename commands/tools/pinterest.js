const { pinterest } = require("@xct007/frieren-scraper");

async function searchPinterest(query) {
    try {
        const results = await pinterest.search(query);
        if (!results || results.length === 0) {
            throw new Error(`Tidak ada hasil yang ditemukan untuk "${query}".`);
        }
        return results;
    } catch (error) {
        console.error("Pinterest API Error:", error);
        throw new Error("Gagal mengambil data dari API Pinterest. Coba lagi nanti.");
    }
}

module.exports = {
    name: "pin",
    description: "Mencari gambar di Pinterest.",
    aliases: ["pinterest"],
    /**
     * @param {import('whatsapp-web.js').Message} message
     * @param {object} options
     * @param {string} options.args - String argumen dari perintah
     */
    async execute(message, options) {
        // Ambil string argumen dari objek 'options'
        const query = options.args;

        if (!query || query.trim().length === 0) {
            return message.reply("Silakan berikan query pencarian. Contoh: .pin naruto");
        }

        try {
            await message.react("⏳");
            const results = await searchPinterest(query);
            const randomImageUrl = results[Math.floor(Math.random() * results.length)];
            
            await message.reply({ image: { url: randomImageUrl }, caption: `*Hasil pencarian untuk:* ${query}` });
            await message.react("✅");

        } catch (error) {
            console.error("Error saat menjalankan perintah 'pin':", error);
            await message.react("❌");
            message.reply(error.message || "Terjadi kesalahan saat mencari gambar di Pinterest.");
        }
    },
};