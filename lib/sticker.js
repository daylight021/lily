const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const { Sticker, StickerTypes } = require("wa-sticker-formatter");
const { execSync } = require('child_process');

// Function untuk deteksi format file berdasarkan header
function detectFileFormat(buffer) {
  if (!buffer || buffer.length < 12) {
    return 'unknown';
  }
  
  const header = buffer.toString('hex', 0, 12).toLowerCase();
  
  // WebM signature
  if (header.startsWith('1a45dfa3')) {
    return 'webm';
  }
  
  // MP4 signatures
  if (header.includes('66747970') || header.startsWith('000000') || 
      header.includes('6d6f6f76') || header.includes('6d646174')) {
    return 'mp4';
  }
  
  // TGS (Telegram animated sticker - Lottie JSON)
  // Tidak didukung, namun kita tetap deteksi untuk pesan error yang lebih baik
  if (buffer.toString('utf8', 0, 10).includes('{') || 
      buffer.toString('utf8', 0, 10).includes('{"')) {
    return 'tgs';
  }
  
  // WebP
  if (header.includes('52494646') && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp';
  }
  
  // PNG
  if (header.startsWith('89504e47')) {
    return 'png';
  }
  
  // JPEG
  if (header.startsWith('ffd8ff')) {
    return 'jpeg';
  }
  
  return 'unknown';
}

// Function untuk validasi dan perbaikan file video
async function validateAndFixVideoFile(inputPath, format) {
  try {
    const stats = fs.statSync(inputPath);
    if (stats.size === 0) {
      throw new Error("File kosong");
    }
    
    console.log(`File detected as: ${format}, size: ${stats.size} bytes`);
    
    if (format === 'webm') {
      return true;
    }
    
    if (format === 'mp4') {
      const fixedPath = inputPath.replace('.mp4', '_fixed.mp4');
      
      try {
        await new Promise((resolve, reject) => {
          ffmpeg(inputPath)
            .outputOptions([
              '-c', 'copy',
              '-movflags', '+faststart'
            ])
            .save(fixedPath)
            .on('end', resolve)
            .on('error', reject);
        });
        
        fs.copyFileSync(fixedPath, inputPath);
        fs.unlinkSync(fixedPath);
        console.log("MP4 file fixed successfully");
        return true;
        
      } catch (fixError) {
        console.log("MP4 fix failed, file might be corrupted");
        return false;
      }
    }
    
    return true;
  } catch (error) {
    console.error("File validation error:", error);
    return false;
  }
}

// Function untuk mendapatkan info video
async function getVideoInfo(inputPath) {
    return new Promise((resolve, reject) => {
        console.log(`Getting video info for file...`);
        
        ffmpeg.ffprobe(inputPath, (err, metadata) => {
            if (err) {
                console.error("FFprobe error:", err.message);
                reject(new Error("Failed to get video metadata."));
            } else {
                console.log("Video info retrieved successfully");
                resolve(metadata);
            }
        });
    });
}

// Fungsi konversi utama dari video ke WebP
async function convertToWebP(inputPath, outputPath, duration) {
  return new Promise((resolve, reject) => {
    // Perbaikan: Pastikan durasi adalah angka yang valid dan positif
    const validDuration = Number.isFinite(duration) && duration > 0 ? Math.min(duration, 8) : 3;
    
    console.log(`Converting video to WebP, duration: ${validDuration}s, with transparency`);
    
    // Opsi FFmpeg untuk mempertahankan alpha channel (transparansi)
    let videoFilters = [
      `scale=384:384:force_original_aspect_ratio=decrease`,
      `pad=384:384:(ow-iw)/2:(oh-ih)/2:color=0x00000000`, // Warna transparan
      `fps=8`
    ];
    
    const filterComplex = videoFilters.join(',');
    
    ffmpeg(inputPath)
      .duration(validDuration)
      .outputOptions([
        '-vcodec', 'libwebp',
        '-vf', filterComplex,
        '-loop', '0',
        '-an',
        '-vsync', '0',
        '-pix_fmt', 'yuva420p',
        '-lossless', '0',
        '-quality', '75',
        '-method', '6'
      ])
      .save(outputPath)
      .on('start', (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on('end', () => {
        console.log('WebP conversion completed successfully');
        resolve();
      })
      .on('error', (err) => {
        console.error('FFmpeg conversion error:', err);
        reject(err);
      });
  });
}

async function createStickerFromVideo(videoBuffer, options = {}) {
  console.log(`Starting video sticker creation, buffer size: ${videoBuffer.length} bytes`);
  
  if (!videoBuffer || videoBuffer.length === 0) {
    throw new Error("Video buffer kosong atau tidak valid");
  }

  const detectedFormat = detectFileFormat(videoBuffer);
  console.log(`Detected file format: ${detectedFormat}`);
  
  // Jika format TGS, langsung tolak
  if (detectedFormat === 'tgs') {
    throw new Error("TGS animated stickers are not supported. Only WebM and static stickers can be processed.");
  }
  
  const tempDir = path.join(__dirname, "../temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const fileExt = detectedFormat === 'webm' ? '.webm' : '.mp4';
  const tempInputPath = path.join(tempDir, `vid_input_${Date.now()}${fileExt}`);
  const tempOutputPath = path.join(tempDir, `vid_output_${Date.now()}.webp`);

  try {
    fs.writeFileSync(tempInputPath, videoBuffer);
    console.log(`Temporary video file created: ${tempInputPath}`);
  } catch (writeError) {
    throw new Error(`Gagal menulis file temporary: ${writeError.message}`);
  }

  try {
    const isValid = await validateAndFixVideoFile(tempInputPath, detectedFormat);
    if (!isValid) {
      throw new Error("Video file validation failed.");
    }
    
    const videoInfo = await getVideoInfo(tempInputPath);
    const videoStream = videoInfo.streams.find(s => s.codec_type === "video");
    
    if (!videoStream) {
      throw new Error("No video stream found in metadata.");
    }

    const duration = parseFloat(videoStream.duration);

    await convertToWebP(tempInputPath, tempOutputPath, duration);
    
    if (!fs.existsSync(tempOutputPath) || fs.statSync(tempOutputPath).size === 0) {
      throw new Error("Output WebP file was not created or is empty.");
    }

    const webpBuffer = fs.readFileSync(tempOutputPath);
    console.log(`WebP created successfully: ${webpBuffer.length} bytes`);

    const sticker = new Sticker(webpBuffer, {
      pack: options.pack || "Bot Stiker",
      author: options.author || "Telegram Import",
      type: StickerTypes.FULL,
      quality: 75,
      background: 'transparent'
    });
    
    return sticker;

  } catch (err) {
    console.error("Error creating sticker from video:", err);
    throw err;
  } finally {
    if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
    if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
  }
}

module.exports = { createStickerFromVideo };
