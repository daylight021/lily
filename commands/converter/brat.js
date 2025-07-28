const axios = require('axios');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');

module.exports = {
    name: "brat",
    description: "Membuat stiker dari teks dengan format khusus.",
    category: "converter",
    execute: async (msg, { bot, args, usedPrefix, command }) => {
        const text = args.join(' ');

        if (!text) {
            return msg.reply(`Kirim perintah dengan format:\n*${usedPrefix + command} <teks kamu>*\n\nContoh:\n${usedPrefix + command} tes stiker 😲`);
        }

        try {
            await msg.react("🎨");

            // --- PERBAIKAN UTAMA: Menggunakan API Eksternal ---
            const apiUrl = `https://api.vacefron.com/api/ttp?text=${encodeURIComponent(text)}`;
            
            // Mengambil gambar dari API
            const response = await axios.get(apiUrl, {
                responseType: 'arraybuffer' // Penting agar hasilnya berupa buffer
            });

            const imageBuffer = Buffer.from(response.data, 'binary');
            // --- AKHIR PERBAIKAN ---

            // Membuat dan Mengirim Stiker
            const sticker = new Sticker(imageBuffer, {
                pack: 'My Bot',
                author: 'Sticker Text',
                type: StickerTypes.FULL,
                quality: 90,
            });

            await bot.sendMessage(msg.from, await sticker.toMessage(), { quoted: msg });

        } catch (error) {
            console.error("Error pada perintah stext (API):", error);
            await msg.react("❌");
            msg.reply("Terjadi kesalahan saat membuat stiker teks via API.");
        }
    },
};