const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');

// Fallback jika rlottie-python tidak tersedia
let rlottie;
try {
  rlottie = require('rlottie-python');
} catch (e) {
  console.warn('rlottie-python tidak ditemukan, animasi .tgs tidak tersedia.');
}

const TEMP = path.join(os.tmpdir(), "sticker");
if (!fs.existsSync(TEMP)) fs.mkdirSync(TEMP, { recursive: true });

function isGzip(buf) {
  return buf[0] === 0x1f && buf[1] === 0x8b;
}

function parseTgs(buffer) {
  if (isGzip(buffer)) buffer = zlib.gunzipSync(buffer);
  return JSON.parse(buffer.toString('utf8'));
}

async function createStickerFromTGS(buffer, opts) {
  if (rlottie && rlottie.LottieAnimation) {
    try {
      let anim = rlottie.LottieAnimation.from_tgs(/* or from_data */ buffer);
      const tmpGif = path.join(TEMP, `tgs_${Date.now()}.gif`);
      anim.save_animation(tmpGif);

      const tmpWebp = path.join(TEMP, `tgs_${Date.now()}.webp`);
      await new Promise((r, e) => {
        ffmpeg(tmpGif)
          .outputOptions([
            '-vcodec', 'libwebp',
            '-lossless', '0',
            '-loop', '0',
            '-qscale', '90',
          ])
          .save(tmpWebp)
          .on('end', r)
          .on('error', e);
      });

      const buf = fs.readFileSync(tmpWebp);
      return new Sticker(buf, { ...opts, type: StickerTypes.FULL, background: 'transparent' });
    } catch (err) {
      console.error('rlottie konversi Gagal:', err.message);
    }
  }

  // Fallback: stiker statis transparan
  const preview = await sharp({
    create: { width: 512, height: 512, channels: 4, background: { r:0,g:0,b:0,alpha:0 } }
  }).png().toBuffer();
  return new Sticker(preview, { ...opts, type: StickerTypes.FULL, background: 'transparent' });
}

module.exports = { createStickerFromTGS };
