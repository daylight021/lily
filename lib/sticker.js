const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const { Sticker, StickerTypes } = require("wa-sticker-formatter");
const { execSync } = require('child_process');

async function convertWebP(inputPath, outputPath, width, height, duration, quality = 85, compression = 3) {
  return new Promise((resolve, reject) => {
    
    const validDuration = Number.isFinite(duration) ? duration : 10;
    const finalDuration = Math.min(validDuration, 10); // Batasi maksimal 10 detik

    ffmpeg(inputPath)
      .duration(finalDuration)
      .outputOptions([
        "-vcodec", "libwebp",
        `-vf`, `scale='min(384,iw)':-2:force_original_aspect_ratio=decrease,fps=8`,
        "-lossless", "0",
        "-compression_level", compression.toString(),
        "-qscale", quality.toString(),
        "-preset", "picture",
        "-loop", "0",
        "-an",
        "-vsync", "0"
      ])
      .save(outputPath)
      .on("end", () => resolve())
      .on("error", reject);
  });
}

async function createStickerFromVideo(videoBuffer, options = {}) {
  // Pastikan direktori temp ada
  const tempDir = path.join(__dirname, "../temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempInputPath = path.join(tempDir, "vid_input.mp4");
  const tempOutputPath = path.join(tempDir, "vid_output.webp");

  fs.writeFileSync(tempInputPath, videoBuffer);

  try {
    const meta = await new Promise((res, rej) =>
      ffmpeg.ffprobe(tempInputPath, (err, metadata) => err ? rej(err) : res(metadata))
    );

    const videoStream = meta.streams.find(s => s.codec_type === "video");

    if (!videoStream || !videoStream.duration) {
      throw new Error("Metadata video tidak ditemukan atau tidak valid.");
    }
    
    const width = videoStream.width;
    const height = videoStream.height;
    const duration = parseFloat(videoStream.duration);

    let quality = 85;
    let compression = 3;
    let attempt = 0;
    const maxAttempts = 3;
    let webpBuffer = null;

    while (attempt < maxAttempts) {
      await convertWebP(tempInputPath, tempOutputPath, width, height, duration, quality, compression);
      webpBuffer = fs.readFileSync(tempOutputPath);

      if (webpBuffer.length < 1024 * 1024) break; // under 1MB
      quality -= 10;
      compression += 1;
      attempt++;
    }

    if (!webpBuffer || webpBuffer.length === 0) {
      throw new Error("Gagal membuat sticker WEBP.");
    }

    const sticker = new Sticker(webpBuffer, {
      pack: options.pack || "xyzbot",
      author: options.author || "xyzuniverse",
      type: StickerTypes.FULL,
      quality: 75,
    });

    return sticker;

  } catch (err) {
    console.error("Gagal memproses video:", err);
    throw err;
  } finally {
    if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
    if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
  }
}

module.exports = { createStickerFromVideo };