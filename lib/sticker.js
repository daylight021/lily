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
    console.error('rlottie-python tidak ditemukan. Install: pip3 install rlottie-python[full]');
    rlottie = null;
}

const TEMP = path.join(os.tmpdir(), 'sticker_conv');
if (!fs.existsSync(TEMP)) fs.mkdirSync(TEMP, { recursive: true });

function isGzip(buf) {
    return buf[0] === 0x1f && buf[1] === 0x8b;
}

function parseTgs(buffer) {
    if (isGzip(buffer)) buffer = zlib.gunzipSync(buffer);
    return JSON.parse(buffer.toString('utf8'));
}

async function createStickerFromTGS(buffer, opts, sendError) {
    if (!rlottie) {
        if (sendError) await sendError('❌ rlottie-python tidak terinstall di server, konversi .tgs gagal.');
        throw new Error('rlottie-python tidak terinstall');
    }

    const tgsFile = path.join(TEMP, `tgs_${Date.now()}.tgs`);
    fs.writeFileSync(tgsFile, buffer);

    try {
        const anim = rlottie.LottieAnimation.from_tgs(tgsFile);
        const gifPath = path.join(TEMP, `tgs_${Date.now()}.gif`);
        anim.save_animation(gifPath);

        const webpPath = path.join(TEMP, `tgs_${Date.now()}.webp`);
        await new Promise((resolve, reject) => {
            ffmpeg(gifPath)
                .outputOptions([
                    '-vcodec', 'libwebp',
                    '-lossless', '0',
                    '-qscale', '80',
                    '-preset', 'default',
                    '-loop', '0',
                    '-an',
                    '-vsync', '0',
                    '-s', '512:512'
                ])
                .save(webpPath)
                .on('end', resolve)
                .on('error', reject);
        });

        const webpBuffer = fs.readFileSync(webpPath);
        return new Sticker(webpBuffer, { ...opts, type: StickerTypes.FULL, background: 'transparent' });
    } catch (err) {
        console.error('Error konversi TGS:', err);
        if (sendError) await sendError('❌ Gagal mengonversi stiker animasi TGS.');
        throw err;
    } finally {
        if (fs.existsSync(tgsFile)) fs.unlinkSync(tgsFile);
    }
}

async function createStickerFromVideo(videoPath, opts) {
    const webpPath = path.join(TEMP, `vid_${Date.now()}.webp`);
    await new Promise((resolve, reject) => {
        ffmpeg(videoPath)
            .outputOptions([
                '-vcodec', 'libwebp',
                '-lossless', '0',
                '-qscale', '80',
                '-preset', 'default',
                '-loop', '0',
                '-an',
                '-vsync', '0',
                '-s', '512:512'
            ])
            .save(webpPath)
            .on('end', resolve)
            .on('error', reject);
    });

    const webpBuffer = fs.readFileSync(webpPath);
    return new Sticker(webpBuffer, { ...opts, type: StickerTypes.FULL, background: 'transparent' });
}

module.exports = {
    createStickerFromTGS,
    createStickerFromVideo
};
