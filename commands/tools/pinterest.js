const { pinterest } = require("@xct007/frieren-scraper");

async function searchPinterest(query) {
    try {
        const results = await pinterest.search(query);
        if (!results || results.length === 0) {
            throw new Error("Tidak ada hasil yang ditemukan untuk query tersebut.");
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
        const query = args.join(" ");
        if (!query) {
            return message.reply("Silakan berikan query pencarian. Contoh: .pin naruto");
        }

        try {
            const results = await searchPinterest(query);
            // Ambil gambar secara acak dari hasil
            const randomImageUrl = results[Math.floor(Math.random() * results.length)];
            
            // Kirim gambar sebagai balasan
            // Pastikan bot Anda memiliki metode untuk mengirim media dari URL. 
            // Biasanya menggunakan `client.sendMessage` dengan media atau metode serupa.
            // Asumsi metode `reply` bisa mengirim URL gambar, jika tidak sesuaikan dengan bot Anda.
            await message.reply({ image: { url: randomImageUrl } });

        } catch (error) {
            console.error("Error pada perintah Pinterest:", error);
            message.reply("Terjadi kesalahan saat mencari gambar di Pinterest.");
        }
    },
};