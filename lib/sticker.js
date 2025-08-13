const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const ffmpeg = require('fluent-ffmpeg');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');

let rlottie;
try {
  rlottie = require('rlottie-python');
} catch (err) {
  console.error('rlottie-python tidak ditemukan. Install di VPS: pip3 install rlottie-python[full]');
  rlottie = null;
}

const TEMP = path.join(os.tmpdir(), 'sticker_conv');
if (!fs.existsSync(TEMP)) fs.mkdirSync(TEMP, { recursive: true });

function isGzip(buf) {
  return buf && buf.length > 1 && buf[0] === 0x1f && buf[1] === 0x8b;
}

function parseTgs(buffer) {
  if (isGzip(buffer)) buffer = zlib.gunzipSync(buffer);
  return JSON.parse(buffer.toString('utf8'));
}

/**
 * Konversi TGS → WebP anim (transparan) via rlottie-python.
 * Jika gagal: lempar error (biar caller yang mengirim notifikasi).
 */
exports.createStickerFromTGS = async function createStickerFromTGS(buffer, opts, sendError) {
  if (!rlottie) {
    if (typeof sendError === 'function') await sendError('❌ rlottie-python tidak terpasang di server.');
    throw new Error('rlottie-python not installed');
  }

  // simpan .tgs dulu (rlottie nyaman membaca path)
  const tgsPath = path.join(TEMP, `tgs_${Date.now()}.tgs`);
  fs.writeFileSync(tgsPath, buffer);

  const tmpGif = path.join(TEMP, `tgs_${Date.now()}.gif`);
  const tmpWebp = path.join(TEMP, `tgs_${Date.now()}.webp`);

  try {
    // (opsional) baca ukuran untuk referensi — tidak wajib
    try { parseTgs(buffer); } catch (_) {}

    const anim = rlottie.LottieAnimation.from_tgs(tgsPath);
    // Simpan animasi ke GIF (rlottie mengeksport frame dengan alpha)
    anim.save_animation(tmpGif);

    // Convert GIF → WebP anim untuk WA
    await new Promise((resolve, reject) => {
      ffmpeg(tmpGif)
        .outputOptions([
          '-vcodec', 'libwebp',
          // Filter: skala max 512, jaga rasio, pad transparan, fps 15
          '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba',
          '-loop', '0',
          '-preset', 'default',
          '-an',
          '-vsync', '0'
        ])
        .save(tmpWebp)
        .on('end', resolve)
        .on('error', reject);
    });

    const webp = fs.readFileSync(tmpWebp);
    return new Sticker(webp, { ...opts, type: StickerTypes.FULL, background: 'transparent' });
  } catch (err) {
    console.error('Error konversi TGS via rlottie:', err);
    if (typeof sendError === 'function') await sendError('❌ Gagal mengonversi stiker animasi TGS.');
    throw err;
  } finally {
    // bersih-bersih
    for (const f of [tgsPath, tmpGif, tmpWebp]) {
      try { fs.existsSync(f) && fs.unlinkSync(f); } catch {}
    }
  }
};

/**
 * Konversi video/gif → WebP anim untuk WA.
 */
exports.createStickerFromVideo = async function createStickerFromVideo(inputPath, opts) {
  const tmpWebp = path.join(TEMP, `vid_${Date.now()}.webp`);
  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-vcodec', 'libwebp',
        '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba',
        '-loop', '0',
        '-preset', 'default',
        '-an',
        '-vsync', '0'
      ])
      .save(tmpWebp)
      .on('end', resolve)
      .on('error', reject);
  });

  const webp = fs.readFileSync(tmpWebp);
  try { fs.unlinkSync(tmpWebp); } catch {}
  return new Sticker(webp, { ...opts, type: StickerTypes.FULL, background: 'transparent' });
};
