const { createStickerFromTGS, createStickerFromVideo } = require('./sticker');
const { Sticker } = require('wa-sticker-formatter');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const os = require('os');

const TEMP = path.join(os.tmpdir(), 'sticker_dl');
if (!fs.existsSync(TEMP)) fs.mkdirSync(TEMP, { recursive: true });

module.exports = {
    name: 'sticker',
    alias: ['stiker', 's'],
    category: 'converter',
    async execute(msg, sock, args) {
        try {
            const sender = msg.key.remoteJid;
            const sendText = async (text) => {
                await sock.sendMessage(sender, { text });
            };

            // Ambil media dari reply
            let mediaType, buffer;
            if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
                const quoted = msg.message.extendedTextMessage.contextInfo.quotedMessage;
                mediaType = Object.keys(quoted)[0];
                buffer = await sock.downloadMediaMessage({ message: quoted });
            } else {
                return sendText('❌ Balas media yang ingin dikonversi.');
            }

            const tempFile = path.join(TEMP, `media_${Date.now()}`);
            fs.writeFileSync(tempFile, buffer);

            let sticker;
            if (mediaType === 'documentMessage' && msg.message.extendedTextMessage.contextInfo.quotedMessage.documentMessage.fileName.endsWith('.tgs')) {
                sticker = await createStickerFromTGS(buffer, { author: 'Bot WA', pack: 'TGS Pack' }, sendText);
            } else if (['videoMessage', 'gifMessage'].includes(mediaType)) {
                sticker = await createStickerFromVideo(tempFile, { author: 'Bot WA', pack: 'Video Pack' });
            } else if (['imageMessage', 'stickerMessage'].includes(mediaType)) {
                sticker = new Sticker(buffer, { author: 'Bot WA', pack: 'Image Pack', type: 'full', background: 'transparent' });
            } else {
                return sendText('❌ Format media tidak didukung.');
            }

            // Buat thumbnail untuk tombol
            let thumbBuffer;
            try {
                if (mediaType === 'imageMessage' || mediaType === 'stickerMessage') {
                    thumbBuffer = buffer;
                } else if (fs.existsSync(tempFile)) {
                    thumbBuffer = await sharp(tempFile).resize(320).png().toBuffer();
                } else if (sticker) {
                    thumbBuffer = await sticker.toBuffer();
                }
            } catch (err) {
                console.error('Gagal membuat thumbnail:', err);
            }

            const buttons = [
                { buttonId: 'sticker_all', buttonText: { displayText: '📦 Semua Stiker' }, type: 1 },
                { buttonId: 'sticker_quarter', buttonText: { displayText: '🧩 1/4 Stiker' }, type: 1 },
                { buttonId: 'sticker_half', buttonText: { displayText: '🔗 1/2 Stiker' }, type: 1 },
                { buttonId: 'sticker_anim', buttonText: { displayText: '🎞 Animasi' }, type: 1 },
                { buttonId: 'sticker_static', buttonText: { displayText: '🖼 Statis' }, type: 1 },
            ];

            await sock.sendMessage(sender, {
                image: thumbBuffer,
                caption: 'Pilih opsi unduhan stiker:',
                footer: 'Bot Sticker Converter',
                buttons,
                headerType: 4
            });

            if (sticker) {
                await sock.sendMessage(sender, await sticker.toMessage());
            }

            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        } catch (err) {
            console.error('Error sticker.js:', err);
            await sock.sendMessage(msg.key.remoteJid, { text: `❌ Terjadi kesalahan: ${err.message}` });
        }
    }
};
