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
    
    // Create timeout for conversion process
    const timeout = setTimeout(() => {
      reject(new Error('Video conversion timeout after 60 seconds'));
    }, 60000);
    
    const ffmpegProcess = ffmpeg(inputPath)
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
        "-vsync", "0",
        "-y" // Overwrite output file
      ])
      .save(outputPath)
      .on("start", (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on("progress", (progress) => {
        console.log('Processing: ' + Math.round(progress.percent) + '% done');
      })
      .on("end", () => {
        clearTimeout(timeout);
        console.log("Video conversion completed");
        resolve();
      })
      .on("error", (err) => {
        clearTimeout(timeout);
        console.error("FFmpeg video conversion error:", err.message);
        reject(err);
      });

    // Handle process termination
    process.on('SIGTERM', () => ffmpegProcess.kill('SIGKILL'));
    process.on('SIGINT', () => ffmpegProcess.kill('SIGKILL'));
  });
}

async function convertImageToWebP(inputPath, outputPath, quality = 90) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Image conversion timeout after 30 seconds'));
    }, 30000);

    ffmpeg(inputPath)
      .outputOptions([
        "-vcodec", "libwebp",
        "-vf", "scale='min(512,iw)':-2:force_original_aspect_ratio=decrease",
        "-lossless", "0",
        "-compression_level", "4",
        "-qscale", quality.toString(),
        "-preset", "picture",
        "-y" // Overwrite output file
      ])
      .save(outputPath)
      .on("start", (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on("end", () => {
        clearTimeout(timeout);
        console.log("Image conversion completed");
        resolve();
      })
      .on("error", (err) => {
        clearTimeout(timeout);
        console.error("FFmpeg image conversion error:", err.message);
        reject(err);
      });
  });
}

async function getMediaMetadata(filePath) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Metadata extraction timeout'));
    }, 15000);

    ffmpeg.ffprobe(filePath, (err, metadata) => {
      clearTimeout(timeout);
      if (err) {
        console.error('FFprobe error:', err.message);
        reject(err);
      } else {
        console.log('Media metadata extracted successfully');
        resolve(metadata);
      }
    });
  });
}

function detectMediaType(buffer) {
  if (!buffer || buffer.length === 0) {
    return 'unknown';
  }

  const header = buffer.slice(0, 32); // Read more bytes for better detection
  
  // TGS detection (gzipped JSON)
  if (header[0] === 0x1F && header[1] === 0x8B) return 'tgs';
  
  // JPEG detection
  if (header[0] === 0xFF && header[1] === 0xD8) return 'jpeg';
  
  // PNG detection
  if (header.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47]))) return 'png';
  
  // WebP detection with animation check
  if (buffer.includes(Buffer.from('WEBP', 'ascii'))) {
    // Check for animation chunks
    if (buffer.includes(Buffer.from('ANIM', 'ascii')) || 
        buffer.includes(Buffer.from('ANMF', 'ascii'))) {
      return 'animated_webp';
    }
    return 'webp';
  }
  
  // GIF detection
  if (header.slice(0, 6).equals(Buffer.from('GIF87a', 'ascii')) ||
      header.slice(0, 6).equals(Buffer.from('GIF89a', 'ascii'))) {
    return 'gif';
  }
  
  // MP4 detection
  if (buffer.slice(4, 8).equals(Buffer.from('ftyp', 'ascii'))) return 'video';
  
  // WebM/MKV detection
  if (header.slice(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'video';
  
  // AVI detection
  if (header.slice(0, 4).equals(Buffer.from('RIFF', 'ascii')) && 
      header.slice(8, 12).equals(Buffer.from('AVI ', 'ascii'))) return 'video';
  
  // MOV detection (alternative QuickTime format)
  if (header.slice(4, 8).equals(Buffer.from('moov', 'ascii')) ||
      header.slice(4, 8).equals(Buffer.from('mdat', 'ascii'))) return 'video';
  
  return 'unknown';
}

async function validateAndFixBuffer(buffer, mediaType) {
  // Basic validation
  if (!buffer || buffer.length === 0) {
    throw new Error('Buffer is empty or invalid');
  }

  if (buffer.length > 15 * 1024 * 1024) { // 15MB limit
    throw new Error('File size too large');
  }

  // Try to detect corruption for common formats
  if (mediaType === 'jpeg' && !(buffer[0] === 0xFF && buffer[1] === 0xD8)) {
    throw new Error('Corrupted JPEG file');
  }

  if (mediaType === 'png' && !buffer.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47]))) {
    throw new Error('Corrupted PNG file');
  }

  return buffer;
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
        const timeout = setTimeout(() => {
          reject(new Error('Compression timeout'));
        }, 45000);

        ffmpeg(inputPath)
          .outputOptions([
            "-vcodec", "libwebp",
            "-vf", "scale='min(512,iw)':-2",
            "-lossless", "0",
            "-compression_level", compression.toString(),
            "-qscale", quality.toString(),
            "-preset", "picture",
            "-y"
          ])
          .save(outputPath)
          .on("end", () => {
            clearTimeout(timeout);
            resolve();
          })
          .on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
          });
      });

      const compressedBuffer = fs.readFileSync(outputPath);
      console.log(`Compressed size: ${compressedBuffer.length} bytes`);
      
      if (compressedBuffer.length < maxFileSize) {
        finalBuffer = compressedBuffer;
        break;
      }
      
      quality = Math.max(quality - 15, 30);
      compression = Math.min(compression + 1, 6);
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
  const timestamp = Date.now();
  const tempInputPath = path.join(tempDir, `input_${timestamp}`);
  const tempOutputPath = path.join(tempDir, `output_${timestamp}.webp`);
  
  try {
    const mediaType = detectMediaType(mediaBuffer);
    console.log(`Processing media type: ${mediaType}, size: ${mediaBuffer.length} bytes`);

    if (mediaType === 'unknown') {
      throw new Error('Unsupported media type or corrupted file');
    }

    // Validate and fix buffer
    await validateAndFixBuffer(mediaBuffer, mediaType);

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
      
      const browser = await lottie.launch({ 
        headless: true, 
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ] 
      });
      
      try {
        const page = await browser.newPage();
        await page.setViewport({ width: 512, height: 512 });
        
        const html = `<!DOCTYPE html>
          <html>
            <body style="margin:0;padding:0;">
              <div id="animation" style="width:512px;height:512px;"></div>
              <script src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js"></script>
              <script>
                lottie.loadAnimation({
                  container: document.getElementById('animation'),
                  renderer: 'canvas',
                  loop: true,
                  autoplay: true,
                  animationData: ${jsonData.toString()}
                });
              </script>
            </body>
          </html>`;
        
        await page.setContent(html);
        await page.waitForTimeout(3000);
        
        await page.screenshot({ 
          path: tempOutputPath, 
          type: 'webp', 
          quality: 90,
          clip: { x: 0, y: 0, width: 512, height: 512 }
        });
        
        processedBuffer = fs.readFileSync(tempOutputPath);
        isAnimated = true;
        
      } finally {
        await browser.close();
      }

    } else if (mediaType === 'animated_webp' || mediaType === 'gif' || mediaType === 'video') {
      isAnimated = true;
      console.log("Processing as video/animated media...");
      
      // Write buffer to temp file with proper extension
      const inputExtension = mediaType === 'gif' ? '.gif' : 
                           mediaType === 'animated_webp' ? '.webp' : '.mp4';
      const properInputPath = tempInputPath + inputExtension;
      
      fs.writeFileSync(properInputPath, mediaBuffer);
      
      try {
        const metadata = await getMediaMetadata(properInputPath);
        await convertVideoToWebP(properInputPath, tempOutputPath, metadata);
        processedBuffer = fs.readFileSync(tempOutputPath);
        
        // Clean up the renamed input file
        if (fs.existsSync(properInputPath)) {
          fs.unlinkSync(properInputPath);
        }
        
      } catch (error) {
        // Clean up the renamed input file on error
        if (fs.existsSync(properInputPath)) {
          fs.unlinkSync(properInputPath);
        }
        throw error;
      }
    
    } else if (mediaType === 'webp' || mediaType === 'jpeg' || mediaType === 'png') {
      console.log("Processing as static image...");
      
      // Write buffer to temp file with proper extension
      const inputExtension = mediaType === 'jpeg' ? '.jpg' : 
                           mediaType === 'png' ? '.png' : '.webp';
      const properInputPath = tempInputPath + inputExtension;
      
      fs.writeFileSync(properInputPath, mediaBuffer);
      
      try {
        await convertImageToWebP(properInputPath, tempOutputPath);
        processedBuffer = fs.readFileSync(tempOutputPath);
        
        // Clean up the renamed input file
        if (fs.existsSync(properInputPath)) {
          fs.unlinkSync(properInputPath);
        }
        
      } catch (error) {
        // Clean up the renamed input file on error
        if (fs.existsSync(properInputPath)) {
          fs.unlinkSync(properInputPath);
        }
        throw error;
      }
    } else {
      throw new Error(`Unsupported media type: ${mediaType}`);
    }
    
    // Check and compress if necessary
    const maxFileSize = 1024 * 1024; // 1MB
    if (processedBuffer.length > maxFileSize) {
        console.log(`File size ${processedBuffer.length} bytes exceeds limit. Starting compression...`);
        const compressedBuffer = await compressSticker(tempOutputPath, tempOutputPath, isAnimated ? 85 : 90);
        if (compressedBuffer) {
            processedBuffer = compressedBuffer;
            console.log(`Compressed to: ${processedBuffer.length} bytes`);
        } else {
            throw new Error("Could not compress sticker to required size limits");
        }
    }
    
    // Create sticker with processed buffer
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
    // Enhanced cleanup
    const filesToClean = [
      tempInputPath,
      tempInputPath + '.gif',
      tempInputPath + '.webp',
      tempInputPath + '.jpg',
      tempInputPath + '.png',
      tempInputPath + '.mp4',
      tempOutputPath
    ];
    
    filesToClean.forEach(file => {
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
          console.log(`Cleaned up temp file: ${path.basename(file)}`);
        } catch (err) {
          console.warn(`Could not delete temp file ${file}:`, err.message);
        }
      }
    });
  }
}

module.exports = { 
  createSticker, 
  detectMediaType,
  validateAndFixBuffer
};
