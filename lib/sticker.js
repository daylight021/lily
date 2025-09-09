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

// IMPROVED: Direct conversion with multiple quality attempts
async function convertVideoToWebPWithCompression(inputPath, outputPath, metadata, targetSize = 900 * 1024) {
  const videoStream = metadata.streams.find(s => s.codec_type === "video");
  const duration = parseFloat(videoStream?.duration) || 10;
  const fps = parseFloat(videoStream?.r_frame_rate?.split('/')[0]) || 8;
  const maxDuration = Math.min(duration, 10);
  
  console.log(`Converting video/gif: duration: ${duration}s, fps: ${fps}, target: ${targetSize} bytes`);
  
  // Define compression strategies for animated content
  const strategies = [
    { quality: 75, resolution: 512, fps: 20, compression: 4, method: 4 },
    { quality: 65, resolution: 450, fps: 15, compression: 5, method: 5 },
    { quality: 55, resolution: 400, fps: 12, compression: 6, method: 6 },
    { quality: 45, resolution: 350, fps: 10, compression: 6, method: 6 },
    { quality: 35, resolution: 300, fps: 8, compression: 6, method: 6 },
    { quality: 30, resolution: 280, fps: 6, compression: 6, method: 6 },
    { quality: 25, resolution: 250, fps: 5, compression: 6, method: 6 },
    { quality: 20, resolution: 220, fps: 4, compression: 6, method: 6 },
    { quality: 15, resolution: 200, fps: 3, compression: 6, method: 6 },
    { quality: 10, resolution: 180, fps: 3, compression: 6, method: 6 }
  ];
  
  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    const tempOutput = `${outputPath}_attempt_${i}`;
    
    try {
      console.log(`Attempt ${i + 1}: quality=${strategy.quality}, resolution=${strategy.resolution}, fps=${strategy.fps}`);
      
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Video conversion timeout after 60 seconds'));
        }, 60000);
        
        const ffmpegProcess = ffmpeg(inputPath)
          .inputOptions(['-t', maxDuration.toString()])
          .outputOptions([
            "-vcodec", "libwebp",
            `-vf`, `scale=${strategy.resolution}:-2:force_original_aspect_ratio=decrease,fps=${strategy.fps}`,
            "-lossless", "0",
            "-compression_level", strategy.compression.toString(),
            "-q:v", strategy.quality.toString(),
            "-method", strategy.method.toString(),
            "-preset", "picture",
            "-loop", "0",
            "-an",
            "-vsync", "0",
            "-y"
          ])
          .save(tempOutput)
          .on("start", (commandLine) => {
            console.log('FFmpeg command:', commandLine);
          })
          .on("progress", (progress) => {
            if (progress.percent) {
              console.log('Processing: ' + Math.round(progress.percent) + '% done');
            }
          })
          .on("end", () => {
            clearTimeout(timeout);
            resolve();
          })
          .on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
          });

        // Handle process termination
        process.on('SIGTERM', () => ffmpegProcess.kill('SIGKILL'));
        process.on('SIGINT', () => ffmpegProcess.kill('SIGKILL'));
      });
      
      // Check if file was created and its size
      if (fs.existsSync(tempOutput)) {
        const stats = fs.statSync(tempOutput);
        console.log(`Attempt ${i + 1} result: ${stats.size} bytes`);
        
        if (stats.size <= targetSize && stats.size > 0) {
          // Success! Move temp file to final output
          fs.renameSync(tempOutput, outputPath);
          console.log(`✅ Target achieved with attempt ${i + 1}: ${stats.size} bytes`);
          return stats.size;
        }
        
        // If this is our last attempt, keep the smallest file
        if (i === strategies.length - 1) {
          fs.renameSync(tempOutput, outputPath);
          console.log(`Using final attempt result: ${stats.size} bytes`);
          return stats.size;
        }
        
        // Clean up temp file
        fs.unlinkSync(tempOutput);
      }
      
    } catch (err) {
      console.log(`Attempt ${i + 1} failed: ${err.message}`);
      // Clean up temp file if it exists
      if (fs.existsSync(tempOutput)) {
        try { fs.unlinkSync(tempOutput); } catch (e) { /* ignore */ }
      }
    }
  }
  
  throw new Error("All video conversion attempts failed");
}

// IMPROVED: Direct conversion with multiple quality attempts for images
async function convertImageToWebPWithCompression(inputPath, outputPath, targetSize = 900 * 1024) {
  console.log(`Converting image, target: ${targetSize} bytes`);
  
  // Define compression strategies for static images
  const strategies = [
    { quality: 85, resolution: 512, compression: 4 },
    { quality: 75, resolution: 512, compression: 5 },
    { quality: 65, resolution: 450, compression: 6 },
    { quality: 55, resolution: 400, compression: 6 },
    { quality: 45, resolution: 350, compression: 6 },
    { quality: 35, resolution: 300, compression: 6 },
    { quality: 30, resolution: 280, compression: 6 },
    { quality: 25, resolution: 250, compression: 6 },
    { quality: 20, resolution: 220, compression: 6 },
    { quality: 15, resolution: 200, compression: 6 }
  ];
  
  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    const tempOutput = `${outputPath}_attempt_${i}`;
    
    try {
      console.log(`Attempt ${i + 1}: quality=${strategy.quality}, resolution=${strategy.resolution}`);
      
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Image conversion timeout after 30 seconds'));
        }, 30000);

        ffmpeg(inputPath)
          .outputOptions([
            "-vcodec", "libwebp",
            "-vf", `scale=${strategy.resolution}:-2:force_original_aspect_ratio=decrease`,
            "-lossless", "0",
            "-compression_level", strategy.compression.toString(),
            "-q:v", strategy.quality.toString(),
            "-preset", "picture",
            "-y"
          ])
          .save(tempOutput)
          .on("start", (commandLine) => {
            console.log('FFmpeg command:', commandLine);
          })
          .on("end", () => {
            clearTimeout(timeout);
            resolve();
          })
          .on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
          });
      });
      
      // Check if file was created and its size
      if (fs.existsSync(tempOutput)) {
        const stats = fs.statSync(tempOutput);
        console.log(`Attempt ${i + 1} result: ${stats.size} bytes`);
        
        if (stats.size <= targetSize && stats.size > 0) {
          // Success! Move temp file to final output
          fs.renameSync(tempOutput, outputPath);
          console.log(`✅ Target achieved with attempt ${i + 1}: ${stats.size} bytes`);
          return stats.size;
        }
        
        // If this is our last attempt, keep the result
        if (i === strategies.length - 1) {
          fs.renameSync(tempOutput, outputPath);
          console.log(`Using final attempt result: ${stats.size} bytes`);
          return stats.size;
        }
        
        // Clean up temp file
        fs.unlinkSync(tempOutput);
      }
      
    } catch (err) {
      console.log(`Attempt ${i + 1} failed: ${err.message}`);
      // Clean up temp file if it exists
      if (fs.existsSync(tempOutput)) {
        try { fs.unlinkSync(tempOutput); } catch (e) { /* ignore */ }
      }
    }
  }
  
  throw new Error("All image conversion attempts failed");
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

  return buffer;
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

    // Validate buffer
    await validateAndFixBuffer(mediaBuffer, mediaType);

    let processedBuffer;
    const targetSize = 900 * 1024; // 900KB target to stay under 1MB after wa-sticker-formatter processing
    
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
        
      } finally {
        await browser.close();
      }

    } else if (mediaType === 'animated_webp' || mediaType === 'gif' || mediaType === 'video') {
      console.log("Processing as video/animated media...");
      
      // Write buffer to temp file with proper extension
      const inputExtension = mediaType === 'gif' ? '.gif' : 
                           mediaType === 'animated_webp' ? '.webp' : '.mp4';
      const properInputPath = tempInputPath + inputExtension;
      
      fs.writeFileSync(properInputPath, mediaBuffer);
      
      try {
        const metadata = await getMediaMetadata(properInputPath);
        const finalSize = await convertVideoToWebPWithCompression(properInputPath, tempOutputPath, metadata, targetSize);
        processedBuffer = fs.readFileSync(tempOutputPath);
        
        console.log(`✅ Animated sticker processed successfully: ${finalSize} bytes`);
        
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
        const finalSize = await convertImageToWebPWithCompression(properInputPath, tempOutputPath, targetSize);
        processedBuffer = fs.readFileSync(tempOutputPath);
        
        console.log(`✅ Static sticker processed successfully: ${finalSize} bytes`);
        
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
    
    // Final size check
    console.log(`Final processed buffer size: ${processedBuffer.length} bytes`);
    
    if (processedBuffer.length > 950 * 1024) { // 950KB final limit
      console.warn(`⚠️ Warning: Final size (${processedBuffer.length} bytes) might be too large for WhatsApp`);
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
    
    // Clean up any temp files with timestamp
    try {
      const tempFiles = fs.readdirSync(tempDir).filter(f => 
        f.includes(timestamp.toString())
      );
      tempFiles.forEach(f => filesToClean.push(path.join(tempDir, f)));
    } catch (e) { /* ignore if temp dir doesn't exist */ }
    
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