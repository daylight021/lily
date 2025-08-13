const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const { Sticker, StickerTypes } = require("wa-sticker-formatter");

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
  const header = buffer.slice(0, 16);
  
  // Deteksi berdasarkan magic bytes
  if (header.includes(Buffer.from('webp', 'ascii'))) return 'webp';
  if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46) return 'gif';
  if (header[0] === 0xFF && header[1] === 0xD8) return 'jpeg';
  if (header.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47]))) return 'png';
  
  // Deteksi TGS (Telegram Sticker) - biasanya dimulai dengan gzip header + JSON
  if (header[0] === 0x1F && header[1] === 0x8B) {
    // Gzip compressed, kemungkinan TGS
    try {
      const zlib = require('zlib');
      const decompressed = zlib.gunzipSync(buffer.slice(0, 100));
      if (decompressed.toString().includes('"tgs":') || decompressed.toString().includes('lottie')) {
        return 'tgs';
      }
    } catch (e) {
      // Bukan TGS, mungkin file gzip lain
    }
  }
  
  // Cek jika dimulai langsung dengan JSON (TGS tidak terkompresi)
  const textStart = buffer.slice(0, 50).toString();
  if (textStart.includes('{"tgs":') || textStart.includes('"nm":') || textStart.includes('"layers":')) {
    return 'tgs';
  }
  
  // Deteksi video berdasarkan mimetype
  if (mimetype) {
    if (mimetype.includes('mp4')) return 'mp4';
    if (mimetype.includes('webm')) return 'webm';
    if (mimetype.includes('mov')) return 'mov';
    if (mimetype.includes('avi')) return 'avi';
    if (mimetype.includes('mkv')) return 'mkv';
    if (mimetype.includes('gif')) return 'gif';
    if (mimetype.includes('webp')) return 'webp';
    if (mimetype.includes('tgs') || mimetype.includes('application/json')) return 'tgs';
  }
  
  return 'unknown';
}

// Fungsi untuk mengonversi TGS (Telegram Sticker) ke WebP
async function convertTGSToWebP(tgsBuffer, options = {}) {
  if (!lottie) {
    throw new Error("Puppeteer not installed. Install with: npm install puppeteer");
  }
  
  const tempDir = ensureTempDir();
  const tgsPath = path.join(tempDir, `tgs_input_${Date.now()}.json`);
  const webpPath = path.join(tempDir, `tgs_output_${Date.now()}.webp`);
  
  try {
    // Decompress TGS jika terkompresi
    let jsonData;
    try {
      const zlib = require('zlib');
      jsonData = zlib.gunzipSync(tgsBuffer);
    } catch (e) {
      // Sudah dalam format JSON
      jsonData = tgsBuffer;
    }
    
    fs.writeFileSync(tgsPath, jsonData);
    
    // Launch browser untuk render Lottie animation
    const browser = await lottie.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 512, height: 512 });
    
    // HTML untuk render Lottie
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js"></script>
        <style>
            body { margin: 0; padding: 0; display: flex; justify-content: center; align-items: center; height: 100vh; }
            #animation { width: 512px; height: 512px; }
        </style>
    </head>
    <body>
        <div id="animation"></div>
        <script>
            const animationData = ${jsonData.toString()};
            lottie.loadAnimation({
                container: document.getElementById('animation'),
                renderer: 'canvas',
                loop: true,
                autoplay: true,
                animationData: animationData
            });
        </script>
    </body>
    </html>`;
    
    await page.setContent(html);
    await page.waitForTimeout(2000); // Wait for animation to load
    
    // Screenshot sebagai WebP
    await page.screenshot({
      path: webpPath,
      type: 'webp',
      quality: 90,
      clip: { x: 0, y: 0, width: 512, height: 512 }
    });
    
    await browser.close();
    
    const webpBuffer = fs.readFileSync(webpPath);
    
    const sticker = new Sticker(webpBuffer, {
      pack: options.pack || "xyzbot",
      author: options.author || "xyzuniverse",
      type: StickerTypes.FULL,
      quality: 90,
    });
    
    return sticker;
    
  } catch (error) {
    console.error("Error converting TGS:", error);
    throw error;
  } finally {
    // Cleanup
    [tgsPath, webpPath].forEach(file => {
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

// Fungsi untuk membuat stiker dari gambar dengan fallback
async function createStickerFromImage(imageBuffer, options = {}) {
  const tempDir = ensureTempDir();
  const mediaType = detectMediaType(imageBuffer, options.mimetype);
  
  console.log(`Processing image as ${mediaType}...`);
  
  // Fallback 1: Coba langsung dengan wa-sticker-formatter untuk WebP
  if (mediaType === 'webp' || mediaType === 'jpeg' || mediaType === 'png') {
    try {
      console.log("Trying direct sticker creation with wa-sticker-formatter...");
      const sticker = new Sticker(imageBuffer, {
        pack: options.pack || "xyzbot",
        author: options.author || "xyzuniverse",
        type: StickerTypes.FULL,
        quality: 90,
      });
      
      console.log("Direct sticker creation successful!");
      return sticker;
    } catch (directError) {
      console.log("Direct creation failed, trying FFmpeg conversion...", directError.message);
    }
  }
  
  // Fallback 2: Gunakan FFmpeg untuk konversi
  let inputExt = 'jpg';
  if (mediaType === 'png') inputExt = 'png';
  else if (mediaType === 'gif') inputExt = 'gif';
  else if (mediaType === 'webp') inputExt = 'webp';
  
  const tempInputPath = path.join(tempDir, `img_input_${Date.now()}.${inputExt}`);
  const tempOutputPath = path.join(tempDir, `img_output_${Date.now()}.webp`);

  try {
    fs.writeFileSync(tempInputPath, imageBuffer);

    // Untuk GIF animasi, gunakan logika video
    if (mediaType === 'gif') {
      console.log("Detected animated GIF, using video conversion logic...");
      const metadata = await getMediaMetadata(tempInputPath);
      await convertVideoToWebP(tempInputPath, tempOutputPath, metadata, 90, 2);
    } else {
      console.log("Converting static image with FFmpeg...");
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

    console.log("FFmpeg sticker creation successful!");
    return sticker;

  } catch (ffmpegError) {
    console.error("FFmpeg conversion failed:", ffmpegError.message);
    
    // Fallback 3: Coba lagi dengan wa-sticker-formatter sebagai fallback terakhir
    try {
      console.log("Trying final fallback with wa-sticker-formatter...");
      const sticker = new Sticker(imageBuffer, {
        pack: options.pack || "xyzbot",
        author: options.author || "xyzuniverse",
        type: StickerTypes.FULL,
        quality: 75, // Lower quality for problematic files
      });
      
      console.log("Final fallback successful!");
      return sticker;
    } catch (finalError) {
      console.error("All conversion methods failed");
      throw new Error(`Image conversion failed: FFmpeg (${ffmpegError.message}) and wa-sticker-formatter (${finalError.message}) both failed`);
    }
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
  
  // Handle TGS files
  if (mediaType === 'tgs') {
    console.log("Processing TGS file...");
    return await convertTGSToWebP(mediaBuffer, options);
  }
  
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
      try {
        return await createStickerFromVideo(mediaBuffer, options);
      } catch (videoError) {
        throw new Error(`Unable to process media: Image conversion (${imageError.message}) and Video conversion (${videoError.message}) both failed`);
      }
    }
  }
}

module.exports = { 
  createStickerFromVideo, 
  createStickerFromImage, 
  createSticker,
  convertTGSToWebP,
  detectMediaType 
};
