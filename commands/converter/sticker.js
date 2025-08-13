// commands/converter/sticker.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');
const { Sticker } = require('wa-sticker-formatter');

const TEMP = path.join(os.tmpdir(), 'sticker_dl');
if (!fs.existsSync(TEMP)) fs.mkdirSync(TEMP, { recursive: true });

// ⛑️ penting: require helper SECARA LAZY (tanpa destructuring di top-level)
// untuk mencegah baca property saat modul masih partial karena siklus.
const conv = require(path.join(__dirname, '../../lib/sticker.js'));

module.exports = {
  name: 'sticker',
  alias: ['stiker', 's'],
  category: 'converter',

  async execute(msg, sock, args) {
    const chatId = msg.key.remoteJid;
    const sendText = async (text) => sock.sendMessage(chatId, { text });

    try {
      // Ambil media dari reply (sesuai pola bot kamu)
      if (!msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        return sendText('❌ Balas media yang ingin dikonversi.');
      }
      const quoted = msg.message.extendedTextMessage.contextInfo.quotedMessage;
      const mediaType = Object.keys(quoted)[0];

      // Unduh buffer media
      const buffer = await sock.downloadMediaMessage({ message: quoted });
      if (!buffer || !buffer.length) return sendText('❌ Media kosong / gagal diunduh.');

      const tempFile = path.join(TEMP, `media_${Date.now()}`);
      fs.writeFileSync(tempFile, buffer);

      // Opsi sticker WA default
      const stickerOpts = {
        author: process.env.stickerAuthor || 'Bot WA',
        pack: process.env.stickerPackname || 'Sticker Pack',
        type: 'full',
        background: 'transparent'
      };

      let sticker;

      // Deteksi TGS berdasarkan nama file dokumen
      const isTgs =
        mediaType === 'documentMessage' &&
        msg.message.extendedTextMessage.contextInfo.quotedMessage.documentMessage.fileName?.toLowerCase().endsWith('.tgs');

      if (isTgs) {
        // gunakan rlottie via helper
        sticker = await conv.createStickerFromTGS(buffer, stickerOpts, sendText);
      } else if (mediaType === 'videoMessage' || mediaType === 'gifMessage') {
        // video/gif → anim webp
        sticker = await conv.createStickerFromVideo(tempFile, stickerOpts);
      } else if (mediaType === 'imageMessage' || mediaType === 'stickerMessage') {
        // gambar/stiker statis → webp statis
        sticker = new Sticker(buffer, stickerOpts);
      } else {
        return sendText('❌ Format media tidak didukung.');
      }

      // Kirim stiker hasil
      if (sticker) {
        await sock.sendMessage(chatId, await sticker.toMessage());
      }

      // Kirim pesan dengan tombol (logika tombol tetap ada, dapat kamu sambungkan ke handler klik)
      // Thumbnail jangan transparan polos agar tidak blank di WA
      let thumbBuffer;
      try {
        if (mediaType === 'imageMessage' || mediaType === 'stickerMessage') {
          thumbBuffer = buffer;
        } else {
          // Buat thumbnail dari sumber (resize 320 px)
          thumbBuffer = await sharp(tempFile).resize(320).png().toBuffer();
        }
      } catch (e) {
        console.warn('Gagal buat thumbnail, pakai buffer stiker sebagai cadangan.');
        try { thumbBuffer = await sticker.toBuffer(); } catch {}
      }

      const buttons = [
        { buttonId: 'sticker_all',     buttonText: { displayText: '📦 Semua Stiker' }, type: 1 },
        { buttonId: 'sticker_quarter', buttonText: { displayText: '🧩 1/4 Stiker' },  type: 1 },
        { buttonId: 'sticker_half',    buttonText: { displayText: '🔗 1/2 Stiker' },  type: 1 },
        { buttonId: 'sticker_anim',    buttonText: { displayText: '🎞 Animasi' },     type: 1 },
        { buttonId: 'sticker_static',  buttonText: { displayText: '🖼 Statis' },      type: 1 },
      ];

      await sock.sendMessage(chatId, {
        image: thumbBuffer,
        caption: 'Pilih opsi unduhan stiker:',
        footer: 'Bot Sticker Converter',
        buttons,
        headerType: 4
      });

      // Bersihkan temp
      try { fs.unlinkSync(tempFile); } catch {}
    } catch (err) {
      console.error('Error sticker.js:', err);
      await sendText(`❌ Terjadi kesalahan: ${err.message}`);
    }
  }
};
