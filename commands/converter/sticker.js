const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');
const { Sticker } = require('wa-sticker-formatter');

// Helper konversi
const conv = require(path.join(__dirname, '../../lib/sticker.js'));

const TEMP = path.join(os.tmpdir(), 'sticker_dl');
if (!fs.existsSync(TEMP)) fs.mkdirSync(TEMP, { recursive: true });

// Thumbnail fallback PNG (ikon default)
const fallbackThumb = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAQAAAAAYLlVAAAAjklEQVR4Ae3QAQ3AIBTEQED7z6tZHTwTQt+MByPp0YcoZCUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJQ0/2rRa5qgIP5vuYAAAAASUVORK5CYII=',
  'base64'
);

module.exports = {
  name: 'sticker',
  alias: ['stiker', 's'],
  category: 'converter',

  async execute(msg, bot, args) {
    const chatId = msg.key.remoteJid;
    const sendText = (text) => msg.reply(text);

    try {
      // Pastikan ada reply ke media
      if (!msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        return sendText('❌ Balas media yang ingin dikonversi.');
      }

      const quoted = msg.message.extendedTextMessage.contextInfo.quotedMessage;
      const mediaType = Object.keys(quoted)[0];

      // Unduh buffer media
      const buffer = await bot.downloadMediaMessage({ message: quoted });
      if (!buffer || !buffer.length) return sendText('❌ Media kosong / gagal diunduh.');

      const tempFile = path.join(TEMP, `media_${Date.now()}`);
      fs.writeFileSync(tempFile, buffer);

      const stickerOpts = {
        author: process.env.stickerAuthor || 'Bot WA',
        pack: process.env.stickerPackname || 'Sticker Pack',
        type: 'full',
        background: 'transparent'
      };

      let sticker;
      let conversionSuccess = true;

      const isTgs =
        mediaType === 'documentMessage' &&
        quoted.documentMessage?.fileName?.toLowerCase().endsWith('.tgs');

      if (isTgs) {
        try {
          sticker = await conv.createStickerFromTGS(buffer, stickerOpts, sendText);
        } catch {
          conversionSuccess = false;
        }
      } else if (mediaType === 'videoMessage' || mediaType === 'gifMessage') {
        sticker = await conv.createStickerFromVideo(tempFile, stickerOpts);
      } else if (mediaType === 'imageMessage' || mediaType === 'stickerMessage') {
        sticker = new Sticker(buffer, stickerOpts);
      } else {
        return sendText('❌ Format media tidak didukung.');
      }

      if (!conversionSuccess) {
        try { fs.unlinkSync(tempFile); } catch {}
        return; // Stop, jangan kirim stiker kosong
      }

      if (sticker) {
        await bot.sendMessage(chatId, await sticker.toMessage());
      }

      // Thumbnail
      let thumbBuffer = fallbackThumb;
      try {
        if (mediaType === 'imageMessage' || mediaType === 'stickerMessage') {
          thumbBuffer = buffer;
        } else {
          thumbBuffer = await sharp(tempFile).resize(320).png().toBuffer();
        }
      } catch (e) {
        console.warn('Gagal membuat thumbnail, pakai default.');
      }

      const buttons = [
        { buttonId: 'sticker_all',     buttonText: { displayText: '📦 Semua Stiker' }, type: 1 },
        { buttonId: 'sticker_quarter', buttonText: { displayText: '🧩 1/4 Stiker' },  type: 1 },
        { buttonId: 'sticker_half',    buttonText: { displayText: '🔗 1/2 Stiker' },  type: 1 },
        { buttonId: 'sticker_anim',    buttonText: { displayText: '🎞 Animasi' },     type: 1 },
        { buttonId: 'sticker_static',  buttonText: { displayText: '🖼 Statis' },      type: 1 },
      ];

      await bot.sendMessage(chatId, {
        image: thumbBuffer,
        caption: 'Pilih opsi unduhan stiker:',
        footer: 'Bot Sticker Converter',
        buttons,
        headerType: 4
      });

      try { fs.unlinkSync(tempFile); } catch {}
    } catch (err) {
      console.error('Error sticker.js:', err);
      await sendText(`❌ Terjadi kesalahan: ${err.message}`);
    }
  }
};
