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
        if (progress.percent) {
          console.log('Processing: ' + Math.round(progress.percent) + '% done');
        }
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

  return buffer;
}

// IMPROVED COMPRESSION FUNCTION - This is the key fix
async function smartCompress(inputPath, outputPath, targetSize = 800 * 1024, isAnimated = false) {
  console.log(`Starting smart compression - target: ${targetSize} bytes`);
  
  const maxAttempts = 10;
  let bestBuffer = null;
  let bestSize = Infinity;
  
  // Different strategies for animated vs static
  const strategies = isAnimated ? [
    // Animated strategies - prioritize frame rate and duration
    { quality: 80, resolution: 512, fps: 10, method: 4 },
    { quality: 70, resolution: 512, fps: 8, method: 5 },
    { quality: 60, resolution: 450, fps: 8, method: 6 },
    { quality: 50, resolution: 400, fps: 6, method: 6 },
    { quality: 40, resolution: 350, fps: 6, method: 6 },
    { quality: 35, resolution: 300, fps: 5, method: 6 },
    { quality: 30, resolution: 280, fps: 5, method: 6 },
    { quality: 25, resolution: 250, fps: 4, method: 6 },
    { quality: 20, resolution: 220, fps: 3, method: 6 },
    { quality: 15, resolution: 200, fps: 3, method: 6 }
  ] : [
    // Static strategies
    { quality: 90, resolution: 512 },
    { quality: 80, resolution: 512 },
    { quality: 70, resolution: 450 },
    { quality: 60, resolution: 400 },
    { quality: 50, resolution: 350 },
    { quality: 40, resolution: 300 },
    { quality: 35, resolution: 280 },
    { quality: 30, resolution: 250 },
    { quality: 25, resolution: 220 },
    { quality: 20, resolution: 200 }
  ];
  
  for (let i = 0; i < Math.min(strategies.length, maxAttempts); i++) {
    const strategy = strategies[i];
    const tempOutput = `${outputPath}_temp_${i}`;
    
    try {
      console.log(`Compression attempt ${i + 1}: quality=${strategy.quality}, resolution=${strategy.resolution}${strategy.fps ? `, fps=${strategy.fps}` : ''}`);
      
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Compression timeout')), 45000);
        
        let ffmpegCmd = ffmpeg(inputPath);
        
        if (isAnimated) {
          ffmpegCmd = ffmpegCmd
            .inputOptions(['-t', '10']) // Limit duration
            .outputOptions([
              "-c:v", "libwebp",
              "-vf", `scale=${strategy.resolution}:${strategy.resolution}:force_original_aspect_ratio=decrease,fps=${strategy.fps}`,
              "-compression_level", "6",
              "-quality", strategy.quality.toString(),
              "-method", strategy.method.toString(),
              "-loop", "0",
              "-preset", "picture",
              "-y"
            ]);
        } else {
          ffmpegCmd = ffmpegCmd
            .outputOptions([
              "-c:v", "libwebp",
              "-vf", `scale=${strategy.resolution}:${strategy.resolution}:force_original_aspect_ratio=decrease`,
              "-compression_level", "6",
              "-quality", strategy.quality.toString(),
              "-method", "6",
              "-preset", "picture",
              "-y"
            ]);
        }
        
        ffmpegCmd
          .save(tempOutput)
          .on("end", () => {
            clearTimeout(timeout);
            resolve();
          })
          .on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
          });
      });
      
      if (fs.existsSync(tempOutput)) {
        const compressedBuffer = fs.readFileSync(tempOutput);
        const size = compressedBuffer.length;
        
        console.log(`Attempt ${i + 1} result: ${size} bytes`);
        
        // Clean up temp file
        fs.unlinkSync(tempOutput);
        
        // Check if this is our best result so far
        if (size <= targetSize) {
          console.log(`✅ Target achieved with attempt ${i + 1}: ${size} bytes`);
          fs.writeFileSync(outputPath, compressedBuffer);
          return compressedBuffer;
        }
        
        // Keep track of best result even if over target
        if (size < bestSize) {
          bestSize = size;
          bestBuffer = compressedBuffer;
        }
      }
      
    } catch (err) {
      console.log(`Attempt ${i + 1} failed: ${err.message}`);
      // Clean up temp file if it exists
      if (fs.existsSync(tempOutput)) {
        try { fs.unlinkSync(tempOutput); } catch (e) { /* ignore */ }
      }
    }
  }
  
  // If we didn't hit target, use the best result we got
  if (bestBuffer) {
    console.log(`Using best result: ${bestSize} bytes (target was ${targetSize})`);
    fs.writeFileSync(outputPath, bestBuffer);
    return bestBuffer;
  }
  
  throw new Error("All compression attempts failed");
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
    
    // SMART COMPRESSION - This is the main improvement
    const targetSize = 800 * 1024; // 800KB target to stay under 1MB after wa-sticker-formatter processing
    console.log(`Initial processed buffer size: ${processedBuffer.length} bytes (target: ${targetSize} bytes)`);
    
    if (processedBuffer.length > targetSize) {
        console.log("File size exceeds target. Starting smart compression...");
        
        // Write current buffer to temp file for compression
        const tempCompressInput = `${tempOutputPath}_compress_input`;
        fs.writeFileSync(tempCompressInput, processedBuffer);
        
        try {
          const compressedBuffer = await smartCompress(tempCompressInput, tempOutputPath, targetSize, isAnimated);
          
          if (compressedBuffer && compressedBuffer.length < 950 * 1024) { // 950KB final limit
              processedBuffer = compressedBuffer;
              console.log(`✅ Smart compression successful: ${processedBuffer.length} bytes`);
          } else {
              console.warn("Smart compression couldn't achieve target size");
              // Still use the compressed result even if it's not perfect
              if (compressedBuffer) {
                processedBuffer = compressedBuffer;
                console.log(`Using best compression result: ${processedBuffer.length} bytes`);
              }
          }
          
          // Clean up compression input
          if (fs.existsSync(tempCompressInput)) {
            fs.unlinkSync(tempCompressInput);
          }
          
        } catch (compressionError) {
          console.error("Smart compression failed:", compressionError.message);
          
          // Clean up compression input
          if (fs.existsSync(tempCompressInput)) {
            fs.unlinkSync(tempCompressInput);
          }
          
          // If compression fails but original processing succeeded, we might still proceed with larger file
          if (processedBuffer.length < 2 * 1024 * 1024) { // If under 2MB, still try
            console.log("Using original processed buffer despite compression failure");
          } else {
            throw new Error("Could not compress sticker to acceptable size");
          }
        }
    } else {
      console.log("✅ File size already acceptable, no compression needed");
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
      tempOutputPath,
      tempOutputPath + '_compress_input'
    ];
    
    // Clean up any temp compression files
    try {
      const tempFiles = fs.readdirSync(tempDir).filter(f => 
        f.includes(timestamp.toString()) || f.includes('temp_')
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
