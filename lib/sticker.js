const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const { Sticker, StickerTypes } = require("wa-sticker-formatter");

// Fungsi untuk memastikan direktori temp exists
function ensureTempDir() {
  const tempDir = path.join(__dirname, "../temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

// Fungsi untuk mengonversi video/gif ke WebP
async function convertVideoToWebP(inputPath, outputPath, metadata, quality = 85, compression = 3) {
  return new Promise((resolve, reject) => {
    const videoStream = metadata.streams.find(s => s.codec_type === "video");
    
    // Validasi dan set default values
    const duration = parseFloat(videoStream?.duration) || 10;
    const fps = parseFloat(videoStream?.r_frame_rate?.split('/')[0]) || 8;
    const width = parseInt(videoStream?.width) || 512;
    const height = parseInt(videoStream?.height) || 512;
    
    // Batasi durasi maksimal 10 detik untuk stiker
    const maxDuration = Math.min(duration, 10);
    
    console.log(`Converting video: ${width}x${height}, duration: ${duration}s, fps: ${fps}`);
    
    ffmpeg(inputPath)
      .inputOptions(['-t', maxDuration.toString()]) // Batasi durasi input
      .outputOptions([
        "-vcodec", "libwebp",
        `-vf`, `scale='min(384,iw)':-2:force_original_aspect_ratio=decrease,fps=8`,
        "-lossless", "0",
        "-compression_level", compression.toString(),
        "-qscale", quality.toString(),
        "-preset", "picture",
        "-loop", "0",
        "-an", // Hapus audio
        "-vsync", "0"
      ])
      .save(outputPath)
      .on("start", (commandLine) => {
        console.log("FFmpeg command:", commandLine);
      })
      .on("progress", (progress) => {
        console.log("Processing: " + progress.percent + "% done");
      })
      .on("end", () => {
        console.log("Video conversion completed");
        resolve();
      })
      .on("error", (err) => {
        console.error("FFmpeg error:", err.message);
        reject(err);
      });
  });
}

// Fungsi untuk mengonversi gambar ke WebP
async function convertImageToWebP(inputPath, outputPath, quality = 90) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-vcodec", "libwebp",
        "-vf", "scale='min(512,iw)':-2:force_original_aspect_ratio=decrease",
        "-lossless", "0",
        "-compression_level", "4",
        "-qscale", quality.toString(),
        "-preset", "picture"
      ])
      .save(outputPath)
      .on("end", () => {
        console.log("Image conversion completed");
        resolve();
      })
      .on("error", reject);
  });
}

// Fungsi untuk mendapatkan metadata file
async function getMediaMetadata(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        console.error("FFprobe error:", err);
        reject(err);
      } else {
        resolve(metadata);
      }
    });
  });
}

// Fungsi untuk mendeteksi tipe media berdasarkan buffer
function detectMediaType(buffer, mimetype = '') {
  const header = buffer.slice(0, 12);
  
  // Deteksi berdasarkan magic bytes
  if (header.includes(Buffer.from('webp', 'ascii'))) return 'webp';
  if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46) return 'gif';
  if (header[0] === 0xFF && header[1] === 0xD8) return 'jpeg';
  if (header.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47]))) return 'png';
  
  // Deteksi video berdasarkan mimetype
  if (mimetype) {
    if (mimetype.includes('mp4')) return 'mp4';
    if (mimetype.includes('webm')) return 'webm';
    if (mimetype.includes('mov')) return 'mov';
    if (mimetype.includes('avi')) return 'avi';
    if (mimetype.includes('mkv')) return 'mkv';
    if (mimetype.includes('gif')) return 'gif';
    if (mimetype.includes('webp')) return 'webp';
  }
  
  return 'unknown';
}

// Fungsi utama untuk membuat stiker dari video
async function createStickerFromVideo(videoBuffer, options = {}) {
  const tempDir = ensureTempDir();
  const tempInputPath = path.join(tempDir, `vid_input_${Date.now()}.mp4`);
  const tempOutputPath = path.join(tempDir, `vid_output_${Date.now()}.webp`);

  try {
    console.log("Writing video buffer to temp file...");
    fs.writeFileSync(tempInputPath, videoBuffer);

    console.log("Getting video metadata...");
    const metadata = await getMediaMetadata(tempInputPath);
    
    // Validasi apakah ada stream video
    const videoStream = metadata.streams.find(s => s.codec_type === "video");
    if (!videoStream) {
      throw new Error("No video stream found in the file");
    }

    let quality = 85;
    let compression = 3;
    let attempt = 0;
    const maxAttempts = 3;
    const maxFileSize = 1024 * 1024; // 1MB
    let webpBuffer = null;

    console.log("Starting video conversion attempts...");
    while (attempt < maxAttempts) {
      console.log(`Attempt ${attempt + 1}/${maxAttempts} - Quality: ${quality}, Compression: ${compression}`);
      
      await convertVideoToWebP(tempInputPath, tempOutputPath, metadata, quality, compression);
      
      if (fs.existsSync(tempOutputPath)) {
        webpBuffer = fs.readFileSync(tempOutputPath);
        console.log(`Generated WebP size: ${webpBuffer.length} bytes`);
        
        if (webpBuffer.length < maxFileSize) {
          console.log("File size acceptable, creating sticker...");
          break;
        }
        
        console.log("File too large, reducing quality...");
      }
      
      quality -= 15;
      compression += 1;
      attempt++;
    }

    if (!webpBuffer || webpBuffer.length >= maxFileSize) {
      throw new Error("Could not create sticker within size limits after multiple attempts");
    }

    const sticker = new Sticker(webpBuffer, {
      pack: options.pack || "xyzbot",
      author: options.author || "xyzuniverse",
      type: StickerTypes.FULL,
      quality: 75,
    });

    console.log("Sticker created successfully!");
    return sticker;

  } catch (error) {
    console.error("Error in createStickerFromVideo:", error);
    throw error;
  } finally {
    // Cleanup temp files
    [tempInputPath, tempOutputPath].forEach(file => {
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
          console.log(`Cleaned up temp file: ${file}`);
        } catch (err) {
          console.warn(`Could not delete temp file ${file}:`, err.message);
        }
      }
    });
  }
}

// Fungsi untuk membuat stiker dari gambar
async function createStickerFromImage(imageBuffer, options = {}) {
  const tempDir = ensureTempDir();
  const mediaType = detectMediaType(imageBuffer, options.mimetype);
  
  let inputExt = 'jpg';
  if (mediaType === 'png') inputExt = 'png';
  else if (mediaType === 'gif') inputExt = 'gif';
  else if (mediaType === 'webp') inputExt = 'webp';
  
  const tempInputPath = path.join(tempDir, `img_input_${Date.now()}.${inputExt}`);
  const tempOutputPath = path.join(tempDir, `img_output_${Date.now()}.webp`);

  try {
    console.log(`Processing image as ${mediaType}...`);
    fs.writeFileSync(tempInputPath, imageBuffer);

    // Untuk GIF animasi, gunakan logika video
    if (mediaType === 'gif') {
      console.log("Detected animated GIF, using video conversion logic...");
      const metadata = await getMediaMetadata(tempInputPath);
      await convertVideoToWebP(tempInputPath, tempOutputPath, metadata, 90, 2);
    } else {
      console.log("Converting static image...");
      await convertImageToWebP(tempInputPath, tempOutputPath, 90);
    }

    const webpBuffer = fs.readFileSync(tempOutputPath);
    console.log(`Generated WebP size: ${webpBuffer.length} bytes`);

    const sticker = new Sticker(webpBuffer, {
      pack: options.pack || "xyzbot",
      author: options.author || "xyzuniverse",
      type: StickerTypes.FULL,
      quality: 90,
    });

    console.log("Image sticker created successfully!");
    return sticker;

  } catch (error) {
    console.error("Error in createStickerFromImage:", error);
    throw error;
  } finally {
    // Cleanup temp files
    [tempInputPath, tempOutputPath].forEach(file => {
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
        } catch (err) {
          console.warn(`Could not delete temp file ${file}:`, err.message);
        }
      }
    });
  }
}

// Fungsi utama untuk membuat stiker dengan auto-detect
async function createSticker(mediaBuffer, options = {}) {
  const mediaType = detectMediaType(mediaBuffer, options.mimetype);
  
  console.log(`Detected media type: ${mediaType}`);
  
  const videoTypes = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'gif'];
  const imageTypes = ['jpeg', 'png', 'webp'];
  
  if (videoTypes.includes(mediaType)) {
    return await createStickerFromVideo(mediaBuffer, options);
  } else if (imageTypes.includes(mediaType)) {
    return await createStickerFromImage(mediaBuffer, options);
  } else {
    // Fallback: coba sebagai gambar dulu, kalau gagal coba sebagai video
    try {
      console.log("Unknown media type, trying as image first...");
      return await createStickerFromImage(mediaBuffer, options);
    } catch (imageError) {
      console.log("Image conversion failed, trying as video...");
      return await createStickerFromVideo(mediaBuffer, options);
    }
  }
}

module.exports = { 
  createStickerFromVideo, 
  createStickerFromImage, 
  createSticker,
  detectMediaType 
};
