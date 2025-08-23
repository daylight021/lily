const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const { Sticker, StickerTypes } = require("wa-sticker-formatter");
const zlib = require('zlib');

// TGS support - optional dependency
let lottie;
try {
  lottie = require("puppeteer"); // Untuk convert TGS ke WebP
} catch (err) {
  console.warn("Puppeteer not installed - TGS support disabled");
}

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
    
    // Batasi durasi maksimal 10 detik untuk stiker
    const maxDuration = Math.min(duration, 10);
    
    console.log(`Converting video/gif: duration: ${duration}s, fps: ${fps}`);
    
    ffmpeg(inputPath)
      .inputOptions(['-t', maxDuration.toString()]) // Batasi durasi input
      .outputOptions([
        "-vcodec", "libwebp",
        `-vf`, `scale='min(512,iw)':-2:force_original_aspect_ratio=decrease,fps=8`,
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
      .on("error", (err) => {
        console.error("FFmpeg image conversion error:", err.message);
        reject(err);
      });
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
  const header = buffer.slice(0, 16);
  if (header[0] === 0x1F && header[1] === 0x8B) return 'tgs';
  if (header[0] === 0xFF && header[1] === 0xD8) return 'jpeg';
  if (header.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47]))) return 'png';
  if (header.includes(Buffer.from('WEBP', 'ascii'))) return 'webp';
  if (header.includes(Buffer.from('GIF8', 'ascii'))) return 'gif';
  
  if (mimetype) {
    if (mimetype.includes('image')) return 'image';
    if (mimetype.includes('video')) return 'video';
  }
  return 'unknown';
}

// Fungsi untuk mengompresi stiker jika ukurannya melebihi 1MB
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
      console.log(`Compressed WebP size: ${compressedBuffer.length} bytes`);

      if (compressedBuffer.length < maxFileSize) {
        console.log("Compression successful. File size is now under 1MB.");
        finalBuffer = compressedBuffer;
        break;
      }

      console.log("File still too large, reducing quality further...");
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

// Fungsi utama untuk membuat stiker
async function createSticker(mediaBuffer, options = {}) {
  const tempDir = ensureTempDir();
  const tempInputPath = path.join(tempDir, `input_${Date.now()}`);
  const tempOutputPath = path.join(tempDir, `output_${Date.now()}.webp`);
  
  try {
    const mediaType = detectMediaType(mediaBuffer, options.mimetype);
    console.log(`Processing media type: ${mediaType}`);

    let processedBuffer;
    
    // Proses TGS secara khusus karena membutuhkan puppeteer
    if (mediaType === 'tgs') {
      if (!lottie) {
        throw new Error("Puppeteer not installed. Install with: npm install puppeteer");
      }
      
      let jsonData;
      try {
        jsonData = zlib.gunzipSync(mediaBuffer);
      } catch (e) {
        jsonData = mediaBuffer;
      }
      fs.writeFileSync(tempInputPath, jsonData);

      // Logika puppeteer untuk TGS
      const browser = await lottie.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      const page = await browser.newPage();
      await page.setViewport({ width: 512, height: 512 });
      
      const html = `<!DOCTYPE html><html><body><div id="animation"></div><script src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js"></script><script>lottie.loadAnimation({container: document.getElementById('animation'),renderer: 'canvas',loop: true,autoplay: true,animationData: ${jsonData.toString()}});</script></body></html>`;
      await page.setContent(html);
      await page.waitForTimeout(2000); 
      await page.screenshot({ path: tempOutputPath, type: 'webp', quality: 90, clip: { x: 0, y: 0, width: 512, height: 512 } });
      await browser.close();
      processedBuffer = fs.readFileSync(tempOutputPath);

    } else if (['gif', 'video'].includes(mediaType) || (mediaType === 'webp' && (options.mimetype.includes('video') || options.mimetype.includes('gif')))) {
      // Proses video dan WebP animasi
      console.log("Processing as video/animated media...");
      fs.writeFileSync(tempInputPath, mediaBuffer);
      const metadata = await getMediaMetadata(tempInputPath);
      await convertVideoToWebP(tempInputPath, tempOutputPath, metadata);
      processedBuffer = fs.readFileSync(tempOutputPath);
    
    } else {
      // Proses gambar statis
      console.log("Processing as static image...");
      fs.writeFileSync(tempInputPath, mediaBuffer);
      await convertImageToWebP(tempInputPath, tempOutputPath);
      processedBuffer = fs.readFileSync(tempOutputPath);
    }
    
    // Pengecekan dan Kompresi Global
    const maxFileSize = 1024 * 1024; // 1MB
    if (processedBuffer.length > maxFileSize) {
        console.log("Final processed buffer is too large. Starting compression...");
        const compressedBuffer = await compressSticker(tempOutputPath, tempOutputPath);
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
    // Cleanup
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
