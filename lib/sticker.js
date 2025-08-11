const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const { Sticker, StickerTypes } = require("wa-sticker-formatter");
const { LottieAnimation } = require('lottie-node');
const { execSync } = require('child_process');

const TEMP_DIR = path.join(__dirname, "../temp");

// Function untuk deteksi format file berdasarkan header
function detectFileFormat(buffer) {
  if (!buffer || buffer.length < 12) {
    return 'unknown';
  }
  
  const header = buffer.toString('hex', 0, 12).toLowerCase();
  
  if (header.startsWith('1a45dfa3')) {
    return 'webm';
  }
  
  if (header.includes('66747970') || header.startsWith('000000') || 
      header.includes('6d6f6f76') || header.includes('6d646174')) {
    return 'mp4';
  }
  
  if (buffer.toString('utf8', 0, 10).includes('{') || 
      buffer.toString('utf8', 0, 10).includes('{"')) {
    return 'tgs';
  }
  
  if (header.includes('52494646') && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp';
  }
  
  if (header.startsWith('89504e47')) {
    return 'png';
  }
  
  if (header.startsWith('ffd8ff')) {
    return 'jpeg';
  }
  
  return 'unknown';
}

// Fungsi baru untuk konversi TGS (Lottie) ke WebP
async function convertTGSToWebP(tgsBuffer, tempDir) {
  return new Promise(async (resolve, reject) => {
    try {
      const animationData = JSON.parse(tgsBuffer.toString('utf8'));
      const lottie = new LottieAnimation(animationData);
      
      const outputPath = path.join(tempDir, `tgs_output_${Date.now()}.webp`);
      
      // Ambil metadata dari animasi Lottie
      const totalFrames = lottie.getTotalFrames();
      const frameRate = lottie.getFrameRate();
      const duration = totalFrames / frameRate;

      // Render bingkai dan gabungkan dengan FFmpeg
      const frameFile = path.join(tempDir, `tgs_frame.png`);
      const imageListFile = path.join(tempDir, `tgs_frames.txt`);

      let imageListContent = '';
      for (let i = 0; i < totalFrames; i++) {
        lottie.goToAndStop(i, true);
        const pngFrame = lottie.get;'png';
        const framePath = path.join(tempDir, `tgs_frame_${String(i).padStart(4, '0')}.png`);
        fs.writeFileSync(framePath, pngFrame);
        imageListContent += `file '${framePath}'\n`;
      }
      fs.writeFileSync(imageListFile, imageListContent);

      ffmpeg()
        .input(imageListFile)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions([
          '-vcodec', 'libwebp',
          '-vf', 'scale=384:384:force_original_aspect_ratio=decrease,pad=384:384:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
          '-loop', '0',
          '-an',
          '-vsync', '0',
          '-pix_fmt', 'yuva420p',
          '-lossless', '0',
          '-quality', '75',
          '-method', '6'
        ])
        .save(outputPath)
        .on('end', () => {
          fs.unlinkSync(imageListFile);
          for (let i = 0; i < totalFrames; i++) {
            fs.unlinkSync(path.join(tempDir, `tgs_frame_${String(i).padStart(4, '0')}.png`));
          }
          resolve(outputPath);
        })
        .on('error', (err) => {
          reject(err);
        });
        
    } catch (err) {
      reject(err);
    }
  });
}

// Fungsi untuk mendapatkan info video (tidak berubah)
async function getVideoInfo(inputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(inputPath, (err, metadata) => {
            if (err) {
                console.error("FFprobe error:", err.message);
                reject(new Error("Failed to get video metadata."));
            } else {
                resolve(metadata);
            }
        });
    });
}

// Fungsi konversi utama dari video ke WebP (tidak berubah)
async function convertToWebP(inputPath, outputPath, duration) {
  return new Promise((resolve, reject) => {
    const validDuration = Number.isFinite(duration) && duration > 0 ? Math.min(duration, 8) : 3;
    
    let videoFilters = [
      `scale=384:384:force_original_aspect_ratio=decrease`,
      `pad=384:384:(ow-iw)/2:(oh-ih)/2:color=0x00000000`, 
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
      .on('end', () => resolve())
      .on('error', (err) => reject(err));
  });
}

// Fungsi untuk membuat sticker dari WebP static (tidak berubah)
async function createStaticWebPFallback(inputBuffer, options) {
  try {
    const stickerOptions = {
      pack: options.pack || "Bot Stiker",
      author: options.author || "Telegram Import",
      type: StickerTypes.FULL,
      quality: 90,
      background: 'transparent'
    };

    const sticker = new Sticker(inputBuffer, stickerOptions);
    return sticker;
    
  } catch (error) {
    throw error;
  }
}

async function createStickerFromVideo(videoBuffer, options = {}) {
  if (!videoBuffer || videoBuffer.length === 0) {
    throw new Error("Video buffer kosong atau tidak valid");
  }

  const detectedFormat = detectFileFormat(videoBuffer);
  
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
  
  let sticker;
  let webpBuffer;

  if (detectedFormat === 'tgs') {
      const outputPath = await convertTGSToWebP(videoBuffer, TEMP_DIR);
      webpBuffer = fs.readFileSync(outputPath);
      fs.unlinkSync(outputPath);
  } else {
      const fileExt = detectedFormat === 'webm' ? '.webm' : '.mp4';
      const tempInputPath = path.join(TEMP_DIR, `vid_input_${Date.now()}${fileExt}`);
      const tempOutputPath = path.join(TEMP_DIR, `vid_output_${Date.now()}.webp`);
      
      try {
        fs.writeFileSync(tempInputPath, videoBuffer);
      
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
        webpBuffer = fs.readFileSync(tempOutputPath);

      } catch (err) {
        throw err;
      } finally {
        if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
        if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
      }
  }

  sticker = new Sticker(webpBuffer, {
    pack: options.pack || "Bot Stiker",
    author: options.author || "Telegram Import",
    type: StickerTypes.FULL,
    quality: 75,
    background: 'transparent'
  });
  
  return sticker;
}

module.exports = { createStickerFromVideo, createStaticWebPFallback };
