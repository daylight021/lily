const yts = require('yt-search');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Fungsi untuk mengunduh menggunakan y2mate API (dari kode sebelumnya)
async function y2mateDownload(url, quality) {
    try {
        const { data } = await axios.get(`https://www.y2mate.com/mates/analyze/ajax`, {
            params: { url, q_auto: 0, ajax: 1 }
        });
        const videoId = /var k = \"(.*?)\";/.exec(data.result)[1];
        const videoResults = data.result.match(/<a href="#" rel="nofollow" type="button" class="btn btn-success" data-fquality="(.*?)"/g);
        if (!videoResults) throw new Error("Tidak ada kualitas video yang ditemukan.");

        const availableQualities = videoResults.map(res => res.match(/data-fquality="(.*?)"/)[1]);
        const chosenQuality = availableQualities.includes(quality) ? quality : availableQualities[0];

        const convertResponse = await axios.post(`https://www.y2mate.com/mates/convert`, new URLSearchParams({
            type: 'youtube',
            _id: videoId,
            v_id: url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/)[1],
            ajax: '1', token: '', ftype: 'mp4', fquality: chosenQuality,
        }));
        
        const downloadLink = /<a href="(.*?)"/.exec(convertResponse.data.result)[1];
        return { downloadLink, chosenQuality };
    } catch (error) {
        throw new Error("Gagal berkomunikasi dengan server unduhan. Coba lagi nanti.");
    }
}

module.exports = {
  name: "ytmp4",
  alias: ["ytv"],
  description: "Unduh video dari YouTube dengan pilihan kualitas HD.",
  execute: async (msg, { bot, args, usedPrefix, command }) => {
    const url = args[0];
    const quality = args[1]?.replace('p', '');

    if (!url) {
      return msg.reply("❌ Masukkan URL YouTube yang valid.");
    }
    const videoId = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/)?.[1];
    if (!videoId) {
        return msg.reply("❌ URL YouTube tidak valid atau tidak dapat menemukan Video ID.");
    }

    try {
        await msg.react("⏳");
        const videoInfo = await yts({ videoId });
        if (!videoInfo) return msg.reply("❌ Video tidak ditemukan.");

        // Jika kualitas belum dipilih, tawarkan tombol
        if (!quality) {
            // --- PERBAIKAN: Struktur Tombol untuk 'lily-baileys' ---
            const templateButtons = [
                { index: 1, quickReplyButton: { displayText: 'Kualitas 720p', id: `${usedPrefix + command} ${url} 720p` } },
                { index: 2, quickReplyButton: { displayText: 'Kualitas 480p', id: `${usedPrefix + command} ${url} 480p` } },
                { index: 3, quickReplyButton: { displayText: 'Kualitas 360p', id: `${usedPrefix + command} ${url} 360p` } },
            ];
            
            const message = {
                text: `*${videoInfo.title}*\n\nSilakan pilih salah satu kualitas video di bawah ini:`,
                footer: 'Tekan tombol untuk mengunduh',
                templateButtons: templateButtons,
                image: { url: videoInfo.thumbnail }
            };
            // --- AKHIR PERBAIKAN ---

            await bot.sendMessage(msg.from, message, { quoted: msg });
            return;
        }

        await msg.reply(`✅ Memproses video *(${quality}p)*... Ini mungkin memakan waktu.`);
        const { downloadLink, chosenQuality } = await y2mateDownload(url, quality);

        // Langsung kirim video dari URL tanpa menyimpan ke file
        await bot.sendMessage(msg.from, { 
            video: { url: downloadLink },
            mimetype: 'video/mp4',
            caption: `✅ Video berhasil diunduh:\n*${videoInfo.title}* (${chosenQuality}p)`
        }, { quoted: msg });

        await msg.react("✅");

    } catch (err) {
      console.error("Proses unduh ytmp4 gagal:", err);
      await msg.react("⚠️");
      return msg.reply(`❌ Gagal memproses video.\n\n*Alasan:* ${err.message}`);
    }
  },
};