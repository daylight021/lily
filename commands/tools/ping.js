// Impor modul 'os' bawaan dari Node.js untuk mendapatkan informasi sistem operasi
const os = require("os");

module.exports = {
  name: "ping",
  description: "Menampilkan informasi dan status server bot.",
  execute: async (msg, { args, bot }) => {
    // Menghitung latensi dari waktu pesan dikirim oleh user hingga diproses oleh bot
    // msg.messageTimestamp biasanya dalam format Unix (detik), jadi dikalikan 1000 untuk menjadi milidetik
    const latency = Date.now() - msg.messageTimestamp * 1000;

    // Mengambil informasi CPU, kita ambil data dari core pertama sebagai representasi
    const cpuModel = os.cpus()[0].model;
    const cpuCores = os.cpus().length;

    // Menghitung penggunaan memori (RAM)
    const totalMemoryGB = (os.totalmem() / 1024 ** 3).toFixed(2);
    const freeMemoryGB = (os.freemem() / 1024 ** 3).toFixed(2);
    const usedMemoryGB = (totalMemoryGB - freeMemoryGB).toFixed(2);

    // Membuat pesan balasan dengan informasi yang telah dikumpulkan
    const serverInfoText = `
*🤖 Informasi Server Bot*

*🕒 Latency:*
• Respon: *${latency} ms*

*💻 Sistem Operasi:*
• Platform: *${os.platform()}*
• Rilis: *${os.release()}*
• Arsitektur: *${os.arch()}*

*⚙️ CPU:*
• Model: *${cpuModel}*
• Jumlah Core: *${cpuCores} Core*

*💾 RAM Server:*
• Digunakan: *${usedMemoryGB} GB / ${totalMemoryGB} GB*
• Sisa: *${freeMemoryGB} GB*
`;

    // Mengirim pesan balasan ke user
    return msg.reply(serverInfoText);
  },

};
