const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const { Sticker, StickerTypes } = require("wa-sticker-formatter");
const zlib = require('zlib');

// TGS support - optional dependency
let lottie;
try {
  lottie = require("puppeteer"); // For converting TGS to WebP
} catch (err) {
  console.warn("Puppeteer not installed - TGS support disabled");
}

function ensureTempDir() {
  const tempDir = path.join(__dirname, "../temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

async function convertVideoToWebP(inputPath, outputPath, metadata, quality = 85, compression = 3) {
  return new Promise((resolve, reject) => {
    const videoStream = metadata.streams.find(s => s.codec_type === "video");
    const duration = parseFloat(videoStream?.duration) || 10;
    const fps = parseFloat(videoStream?.r_frame_rate?.split('/')[0]) || 8;
    const maxDuration = Math.min(duration, 10);
    
    console.log(`Converting video/gif: duration: ${duration}s, fps: ${fps}`);
    
    ffmpeg(inputPath)
      .inputOptions(['-t', maxDuration.toString()])
      .outputOptions([
        "-vcodec", "libwebp",
        `-vf`, `scale='min(512,iw)':-2:force_original_aspect_ratio=decrease,fps=8`,
        "-lossless", "0",
        "-compression_level", compression.toString(),
        "-qscale", quality.toString(),
        "-preset", "picture",
        "-loop", "0",
        "-an",
        "-vsync", "0"
      ])
      .save(outputPath)
      .on("end", () => {
        console.log("Video conversion completed");
        resolve();
      })
      .on("error", (err) => {
        console.error("FFmpeg video conversion error:", err.message);
        reject(err);
      });
  });
}

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
      .on("error", (err) => {
        console.error("FFmpeg image conversion error:", err.message);
        reject(err);
      });
  });
}

async function getMediaMetadata(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        resolve(metadata);
      }
    });
  });
}

function detectMediaType(buffer) {
  const header = buffer.slice(0, 16);
  if (header[0] === 0x1F && header[1] === 0x8B) return 'tgs';
  if (header[0] === 0xFF && header[1] === 0xD8) return 'jpeg';
  if (header.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47]))) return 'png';
  if (header.includes(Buffer.from('WEBP', 'ascii'))) {
    // Check for "ANIM" chunk to detect animated WebP
    if (buffer.includes(Buffer.from('ANIM', 'ascii'))) {
      return 'animated_webp';
    }
    return 'webp';
  }
  if (header.includes(Buffer.from('GIF8', 'ascii'))) return 'gif';
  
  // Fallback to check common video magic bytes
  if (buffer.slice(4, 8).equals(Buffer.from('ftyp', 'ascii')) || buffer.slice(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
      return 'video';
  }
  
  return 'unknown';
}

async function compressSticker(inputPath, outputPath, initialQuality = 90) {
  const maxFileSize = 1024 * 1024; // 1MB
  let quality = initialQuality;
  let compression = 6;
  let attempt = 0;
  const maxAttempts = 5;
  let finalBuffer = null;

  while (attempt < maxAttempts) {
    console.log(`Compression Attempt ${attempt + 1}/${maxAttempts} - Quality: ${quality}, Compression: ${compression}`);
    
    try {
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .outputOptions([
            "-vcodec", "libwebp",
            "-vf", "scale='min(512,iw)':-2",
            "-lossless", "0",
            "-compression_level", compression.toString(),
            "-qscale", quality.toString(),
            "-preset", "picture"
          ])
          .save(outputPath)
          .on("end", resolve)
          .on("error", reject);
      });

      const compressedBuffer = fs.readFileSync(outputPath);
      if (compressedBuffer.length < maxFileSize) {
        finalBuffer = compressedBuffer;
        break;
      }
      quality -= 10;
      compression += 1;
      attempt++;
    } catch (err) {
      console.error("Compression error:", err.message);
      break;
    }
  }
  return finalBuffer;
}

async function createSticker(mediaBuffer, options = {}) {
  const tempDir = ensureTempDir();
  const tempInputPath = path.join(tempDir, `input_${Date.now()}`);
  const tempOutputPath = path.join(tempDir, `output_${Date.now()}.webp`);
  
  try {
    const mediaType = detectMediaType(mediaBuffer);
    console.log(`Processing media type: ${mediaType}`);

    let processedBuffer;
    let isAnimated = false;
    
    if (mediaType === 'tgs') {
      if (!lottie) {
        throw new Error("Puppeteer not installed.");
      }
      let jsonData;
      try {
        jsonData = zlib.gunzipSync(mediaBuffer);
      } catch (e) {
        jsonData = mediaBuffer;
      }
      fs.writeFileSync(tempInputPath, jsonData);
      const browser = await lottie.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      const page = await browser.newPage();
      await page.setViewport({ width: 512, height: 512 });
      const html = `<!DOCTYPE html><html><body><div id="animation"></div><script src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js"></script><script>lottie.loadAnimation({container: document.getElementById('animation'),renderer: 'canvas',loop: true,autoplay: true,animationData: ${jsonData.toString()}});</script></body></html>`;
      await page.setContent(html);
      await page.waitForTimeout(2000); 
      await page.screenshot({ path: tempOutputPath, type: 'webp', quality: 90, clip: { x: 0, y: 0, width: 512, height: 512 } });
      await browser.close();
      processedBuffer = fs.readFileSync(tempOutputPath);
      isAnimated = true;

    } else if (mediaType === 'animated_webp' || mediaType === 'gif' || mediaType === 'video') {
      isAnimated = true;
      console.log("Processing as video/animated media...");
      fs.writeFileSync(tempInputPath, mediaBuffer);
      const metadata = await getMediaMetadata(tempInputPath);
      await convertVideoToWebP(tempInputPath, tempOutputPath, metadata);
      processedBuffer = fs.readFileSync(tempOutputPath);
    
    } else if (mediaType === 'webp' || mediaType === 'jpeg' || mediaType === 'png') {
      console.log("Processing as static image...");
      fs.writeFileSync(tempInputPath, mediaBuffer);
      await convertImageToWebP(tempInputPath, tempOutputPath);
      processedBuffer = fs.readFileSync(tempOutputPath);
    } else {
      throw new Error("Unsupported media type.");
    }
    
    const maxFileSize = 1024 * 1024; // 1MB
    if (processedBuffer.length > maxFileSize) {
        console.log("Final processed buffer is too large. Starting compression...");
        const compressedBuffer = await compressSticker(tempOutputPath, tempOutputPath, isAnimated ? 85 : 90);
        if (compressedBuffer) {
            processedBuffer = compressedBuffer;
        } else {
            throw new Error("Could not compress sticker to required size.");
        }
    }
    
    const sticker = new Sticker(processedBuffer, {
      pack: options.pack || "xyzbot",
      author: options.author || "xyzuniverse",
      type: StickerTypes.FULL,
      quality: 90,
    });
    
    return sticker;

  } catch (error) {
    console.error("Error in createSticker:", error);
    throw error;
  } finally {
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

module.exports = { 
  createSticker, 
  detectMediaType 
};
