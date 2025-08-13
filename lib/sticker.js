const fs = require("fs");
const path = require("path");
const os = require("os");
const sharp = require("sharp");
const ffmpeg = require("fluent-ffmpeg");
const { Sticker } = require("wa-sticker-formatter");
const { createCanvas } = require("canvas");
const lottie = require("lottie-node");

const TEMP_DIR = path.join(os.tmpdir(), "sticker_temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

/**
 * Konversi video/gif ke stiker animasi
 */
async function createStickerFromVideo(videoBuffer, stickerOptions) {
    const inputPath = path.join(TEMP_DIR, `input_${Date.now()}.mp4`);
    const outputPath = path.join(TEMP_DIR, `output_${Date.now()}.webp`);
    fs.writeFileSync(inputPath, videoBuffer);

    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .outputOptions([
                "-vcodec", "libwebp",
                "-vf", "scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:-1:-1:color=0x00000000",
                "-loop", "0",
                "-preset", "default",
                "-an",
                "-vsync", "0"
            ])
            .save(outputPath)
            .on("end", async () => {
                try {
                    const sticker = new Sticker(fs.readFileSync(outputPath), stickerOptions);
                    fs.unlinkSync(inputPath);
                    fs.unlinkSync(outputPath);
                    resolve(sticker);
                } catch (err) {
                    reject(err);
                }
            })
            .on("error", (err) => reject(err));
    });
}

/**
 * Konversi .tgs (Lottie JSON) ke stiker animasi WebP transparan
 */
async function createStickerFromTGS(tgsBuffer, stickerOptions) {
    const jsonData = JSON.parse(tgsBuffer.toString());
    const anim = lottie.loadAnimation(jsonData);

    const width = anim.w || 512;
    const height = anim.h || 512;
    const fps = 30;
    const totalFrames = Math.floor(anim.op - anim.ip);

    const frameFiles = [];

    for (let i = 0; i < totalFrames; i++) {
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext("2d");

        ctx.clearRect(0, 0, width, height);
        lottie.renderFrame(anim, i, ctx);

        const pngBuffer = canvas.toBuffer("image/png");
        const framePath = path.join(TEMP_DIR, `frame_${i}.png`);
        fs.writeFileSync(framePath, pngBuffer);
        frameFiles.push(framePath);
    }

    const webpPath = path.join(TEMP_DIR, `anim_${Date.now()}.webp`);

    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(`concat:${frameFiles.join("|")}`)
            .inputFormat("image2pipe")
            .outputOptions([
                "-vcodec", "libwebp",
                `-r`, `${fps}`,
                "-loop", "0",
                "-preset", "default",
                "-an",
                "-vsync", "0"
            ])
            .save(webpPath)
            .on("end", () => {
                try {
                    const sticker = new Sticker(fs.readFileSync(webpPath), stickerOptions);
                    frameFiles.forEach(f => fs.unlinkSync(f));
                    fs.unlinkSync(webpPath);
                    resolve(sticker);
                } catch (err) {
                    reject(err);
                }
            })
            .on("error", (err) => reject(err));
    });
}

module.exports = {
    createStickerFromVideo,
    createStickerFromTGS
};
