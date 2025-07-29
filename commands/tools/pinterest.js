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
    async execute(message, args) {
        // Langsung gunakan 'args' sebagai query karena bukan array
        const query = args;

        if (!query || query.trim().length === 0) {
            return message.reply("Silakan berikan query pencarian. Contoh: .pin naruto");
        }

        try {
            const results = await searchPinterest(query);
            const randomImageUrl = results[Math.floor(Math.random() * results.length)];
            
            // Baris ini mungkin perlu disesuaikan dengan pustaka WhatsApp (baileys, etc.) yang Anda gunakan.
            // Kode ini mengasumsikan bot dapat mengirim gambar dari URL.
            await message.reply({ image: { url: randomImageUrl } });

        } catch (error) {
            console.error("Error saat menjalankan perintah 'pin':", error);
            // Mengirim pesan galat yang lebih spesifik ke pengguna
            message.reply(error.message || "Terjadi kesalahan saat mencari gambar di Pinterest.");
        }
    },
};