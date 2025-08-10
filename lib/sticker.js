const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const { Sticker, StickerTypes } = require("wa-sticker-formatter");
const { execSync } = require('child_process');

async function convertWebP(inputPath, outputPath, width, height, duration, quality = 85, compression = 3, preserveTransparency = true) {
  return new Promise((resolve, reject) => {
    
    const validDuration = Number.isFinite(duration) ? duration : 10;
    const finalDuration = Math.min(validDuration, 10); // Batasi maksimal 10 detik

    // Filter video dengan dukungan transparansi yang lebih baik
    let videoFilter = `scale='min(384,iw)':-2:force_original_aspect_ratio=decrease,fps=8`;
    
    // Jika ingin preserve transparency, gunakan format yang mendukung alpha channel
    if (preserveTransparency) {
      // Pastikan background transparan dipertahankan
      videoFilter = `scale='min(384,iw)':-2:force_original_aspect_ratio=decrease,fps=8,format=yuva420p`;
    }

    const outputOptions = [
      "-vcodec", "libwebp",
      `-vf`, videoFilter,
      "-lossless", preserveTransparency ? "1" : "0", // Gunakan lossless untuk transparency
      "-compression_level", compression.toString(),
      "-preset", "picture",
      "-loop", "0",
      "-an",
      "-vsync", "0"
    ];

    // Jika tidak preserve transparency, gunakan qscale
    if (!preserveTransparency) {
      outputOptions.push("-qscale", quality.toString());
    }

    ffmpeg(inputPath)
      .duration(finalDuration)
      .outputOptions(outputOptions)
      .save(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => {
        console.error("FFmpeg error:", err);
        reject(err);
      });
  });
}

async function createStickerFromVideo(videoBuffer, options = {}) {
  // Pastikan direktori temp ada
  const tempDir = path.join(__dirname, "../temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempInputPath = path.join(tempDir, `vid_input_${Date.now()}.mp4`);
  const tempOutputPath = path.join(tempDir, `vid_output_${Date.now()}.webp`);

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
    const preserveTransparency = options.preserveTransparency !== false; // Default true

    let quality = preserveTransparency ? 100 : 85; // Gunakan kualitas tinggi untuk transparency
    let compression = preserveTransparency ? 6 : 3; // Compression lebih tinggi untuk transparency
    let attempt = 0;
    const maxAttempts = preserveTransparency ? 2 : 3; // Lebih sedikit attempt untuk transparency
    let webpBuffer = null;

    console.log(`Creating ${preserveTransparency ? 'transparent' : 'regular'} sticker from video...`);

    while (attempt < maxAttempts) {
      try {
        await convertWebP(tempInputPath, tempOutputPath, width, height, duration, quality, compression, preserveTransparency);
        
        if (fs.existsSync(tempOutputPath)) {
          webpBuffer = fs.readFileSync(tempOutputPath);
          
          // Untuk transparency, tidak terlalu ketat dengan ukuran file
          const maxSize = preserveTransparency ? 2 * 1024 * 1024 : 1024 * 1024; // 2MB untuk transparency
          
          if (webpBuffer.length < maxSize) break; // under limit
          
          if (!preserveTransparency) {
            quality -= 10;
            compression += 1;
          } else {
            // Untuk transparency, coba kurangi compression saja
            compression = Math.max(0, compression - 1);
          }
        } else {
          throw new Error("Output file tidak dibuat oleh FFmpeg");
        }
      } catch (conversionError) {
        console.error(`Conversion attempt ${attempt + 1} failed:`, conversionError);
        if (preserveTransparency && attempt === 0) {
          // Jika transparency gagal, coba tanpa transparency
          console.log("Transparency conversion failed, trying without transparency...");
          preserveTransparency = false;
          quality = 85;
          compression = 3;
        }
      }
      
      attempt++;
    }

    if (!webpBuffer || webpBuffer.length === 0) {
      throw new Error("Gagal membuat sticker WEBP setelah beberapa percobaan.");
    }

    console.log(`WebP created successfully: ${webpBuffer.length} bytes`);

    const stickerOptions = {
      pack: options.pack || "xyzbot",
      author: options.author || "xyzuniverse",
      type: StickerTypes.FULL,
      quality: 75,
    };

    // Jika berhasil preserve transparency, pastikan sticker juga transparan
    if (preserveTransparency) {
      stickerOptions.background = 'transparent';
    }

    const sticker = new Sticker(webpBuffer, stickerOptions);

    return sticker;

  } catch (err) {
    console.error("Gagal memproses video:", err);
    throw err;
  } finally {
    // Cleanup temp files
    try {
      if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
      if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
    } catch (cleanupError) {
      console.error("Error cleaning up temp files:", cleanupError);
    }
  }
}

module.exports = { createStickerFromVideo };
