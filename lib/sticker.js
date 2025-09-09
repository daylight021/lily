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

// IMPROVED: Simplified conversion based on your working code
async function convertToWebPOptimized(inputPath, outputPath, isVideo = false, targetSize = 1024 * 1024) {
  console.log(`Converting ${isVideo ? 'video' : 'image'} with optimized approach...`);
  
  const strategies = isVideo ? [
    { quality: 85, fps: 8, scale: 384, compression: 3 },
    { quality: 75, fps: 8, scale: 320, compression: 4 },
    { quality: 65, fps: 6, scale: 280, compression: 5 },
    { quality: 55, fps: 6, scale: 256, compression: 6 },
    { quality: 45, fps: 4, scale: 224, compression: 6 },
  ] : [
    { quality: 85, scale: 384 },
    { quality: 75, scale: 320 },
    { quality: 65, scale: 280 },
    { quality: 55, scale: 256 },
    { quality: 45, scale: 224 },
  ];

  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    const tempOutput = `${outputPath}_temp_${i}`;
    
    try {
      console.log(`Attempt ${i + 1}: quality=${strategy.quality}, scale=${strategy.scale}${strategy.fps ? `, fps=${strategy.fps}` : ''}`);
      
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Conversion timeout'));
        }, 60000);

        let ffmpegCmd = ffmpeg(inputPath);
        
        if (isVideo) {
          ffmpegCmd = ffmpegCmd
            .duration(10) // Limit to 10 seconds
            .outputOptions([
              "-vcodec", "libwebp",
              "-vf", `scale='min(${strategy.scale},iw)':-2:force_original_aspect_ratio=decrease,fps=${strategy.fps}`,
              "-lossless", "0",
              "-compression_level", (strategy.compression || 3).toString(),
              "-qscale", strategy.quality.toString(),
              "-preset", "picture",
              "-loop", "0",
              "-an",
              "-vsync", "0"
            ]);
        } else {
          ffmpegCmd = ffmpegCmd
            .outputOptions([
              "-vcodec", "libwebp",
              "-vf", `scale='min(${strategy.scale},iw)':-2:force_original_aspect_ratio=decrease`,
              "-lossless", "0", 
              "-qscale", strategy.quality.toString(),
              "-preset", "picture"
            ]);
        }
        
        ffmpegCmd
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
      
      if (fs.existsSync(tempOutput)) {
        const stats = fs.statSync(tempOutput);
        console.log(`Attempt ${i + 1} result: ${stats.size} bytes`);
        
        if (stats.size <= targetSize && stats.size > 0) {
          fs.renameSync(tempOutput, outputPath);
          console.log(`✅ Conversion successful: ${stats.size} bytes`);
          return stats.size;
        }
        
        // Keep the smallest result for last attempt
        if (i === strategies.length - 1) {
          fs.renameSync(tempOutput, outputPath);
          console.log(`Using final result: ${stats.size} bytes`);
          return stats.size;
        }
        
        fs.unlinkSync(tempOutput);
      }
      
    } catch (err) {
      console.log(`Attempt ${i + 1} failed: ${err.message}`);
      if (fs.existsSync(tempOutput)) {
        try { fs.unlinkSync(tempOutput); } catch (e) { /* ignore */ }
      }
    }
  }
  
  throw new Error("All conversion attempts failed");
}

// FALLBACK: Ultra-simple conversion
async function fallbackConversion(inputPath, outputPath, isVideo = false) {
  console.log("Using ultra-simple fallback conversion...");
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Fallback conversion timeout'));
    }, 45000);

    let ffmpegCmd = ffmpeg(inputPath);
    
    if (isVideo) {
      ffmpegCmd = ffmpegCmd
        .duration(10)
        .outputOptions([
          "-vcodec", "libwebp",
          "-vf", "scale=256:-1,fps=6",
          "-loop", "0",
          "-an"
        ]);
    } else {
      ffmpegCmd = ffmpegCmd
        .outputOptions([
          "-vcodec", "libwebp",
          "-vf", "scale=256:-1"
        ]);
    }
    
    ffmpegCmd
      .save(outputPath)
      .on("start", (commandLine) => {
        console.log('Fallback FFmpeg command:', commandLine);
      })
      .on("end", () => {
        clearTimeout(timeout);
        const stats = fs.statSync(outputPath);
        console.log(`Fallback conversion completed: ${stats.size} bytes`);
        resolve(stats.size);
      })
      .on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
  });
}

// WEBP SPECIAL HANDLING: Based on your approach
async function handleWebPFile(inputPath, outputPath, targetSize = 1024 * 1024) {
  console.log("Special WebP handling...");
  
  // First check if we can just copy the file
  const stats = fs.statSync(inputPath);
  if (stats.size <= targetSize) {
    console.log(`WebP file already small enough (${stats.size} bytes), copying as-is`);
    fs.copyFileSync(inputPath, outputPath);
    return stats.size;
  }
  
  // Try to validate the WebP file first
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WebP validation timeout')), 10000);
      
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        clearTimeout(timeout);
        if (err) {
          console.log("WebP validation failed, might be corrupted");
          reject(err);
        } else {
          console.log("WebP file validated successfully");
          resolve(metadata);
        }
      });
    });
    
    // If validation passed, try conversion with optimized approach
    return await convertToWebPOptimized(inputPath, outputPath, false, targetSize);
    
  } catch (validationError) {
    console.log("WebP validation failed, trying simple resize...");
    
    // Try very basic resize for corrupted WebP
    try {
      return await fallbackConversion(inputPath, outputPath, false);
    } catch (fallbackError) {
      // If everything fails but original is not too big, use it
      if (stats.size < 2 * 1024 * 1024) { // Under 2MB
        console.log("All WebP processing failed, using original file");
        fs.copyFileSync(inputPath, outputPath);
        return stats.size;
      }
      throw new Error("WebP file is corrupted and too large to process");
    }
  }
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

  const header = buffer.slice(0, 32);
  
  // TGS detection (gzipped JSON)
  if (header[0] === 0x1F && header[1] === 0x8B) return 'tgs';
  
  // JPEG detection
  if (header[0] === 0xFF && header[1] === 0xD8) return 'jpeg';
  
  // PNG detection
  if (header.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47]))) return 'png';
  
  // WebP detection with animation check
  if (buffer.includes(Buffer.from('WEBP', 'ascii'))) {
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
  
  // MOV detection
  if (header.slice(4, 8).equals(Buffer.from('moov', 'ascii')) ||
      header.slice(4, 8).equals(Buffer.from('mdat', 'ascii'))) return 'video';
  
  return 'unknown';
}

async function validateAndFixBuffer(buffer, mediaType) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Buffer is empty or invalid');
  }

  if (buffer.length > 15 * 1024 * 1024) {
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

    await validateAndFixBuffer(mediaBuffer, mediaType);

    let processedBuffer;
    const targetSize = 950 * 1024; // 950KB target for safety margin
    
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
      
      const inputExtension = mediaType === 'gif' ? '.gif' : 
                           mediaType === 'animated_webp' ? '.webp' : '.mp4';
      const properInputPath = tempInputPath + inputExtension;
      
      fs.writeFileSync(properInputPath, mediaBuffer);
      
      try {
        try {
          const finalSize = await convertToWebPOptimized(properInputPath, tempOutputPath, true, targetSize);
          processedBuffer = fs.readFileSync(tempOutputPath);
          console.log(`✅ Animated sticker processed successfully: ${finalSize} bytes`);
        } catch (optimizedError) {
          console.log("Optimized conversion failed, trying fallback...");
          await fallbackConversion(properInputPath, tempOutputPath, true);
          processedBuffer = fs.readFileSync(tempOutputPath);
          console.log(`✅ Animated sticker processed with fallback: ${processedBuffer.length} bytes`);
        }
        
        if (fs.existsSync(properInputPath)) {
          fs.unlinkSync(properInputPath);
        }
        
      } catch (error) {
        if (fs.existsSync(properInputPath)) {
          fs.unlinkSync(properInputPath);
        }
        throw error;
      }
    
    } else if (mediaType === 'webp' || mediaType === 'jpeg' || mediaType === 'png') {
      console.log("Processing as static image...");
      
      const inputExtension = mediaType === 'jpeg' ? '.jpg' : 
                           mediaType === 'png' ? '.png' : '.webp';
      const properInputPath = tempInputPath + inputExtension;
      
      fs.writeFileSync(properInputPath, mediaBuffer);
      
      try {
        if (mediaType === 'webp') {
          // Special handling for WebP files
          const finalSize = await handleWebPFile(properInputPath, tempOutputPath, targetSize);
          processedBuffer = fs.readFileSync(tempOutputPath);
          console.log(`✅ WebP sticker processed successfully: ${finalSize} bytes`);
        } else {
          // Handle JPEG and PNG
          try {
            const finalSize = await convertToWebPOptimized(properInputPath, tempOutputPath, false, targetSize);
            processedBuffer = fs.readFileSync(tempOutputPath);
            console.log(`✅ Static sticker processed successfully: ${finalSize} bytes`);
          } catch (optimizedError) {
            console.log("Optimized conversion failed, trying fallback...");
            await fallbackConversion(properInputPath, tempOutputPath, false);
            processedBuffer = fs.readFileSync(tempOutputPath);
            console.log(`✅ Static sticker processed with fallback: ${processedBuffer.length} bytes`);
          }
        }
        
        if (fs.existsSync(properInputPath)) {
          fs.unlinkSync(properInputPath);
        }
        
      } catch (error) {
        if (fs.existsSync(properInputPath)) {
          fs.unlinkSync(properInputPath);
        }
        throw error;
      }
    } else {
      throw new Error(`Unsupported media type: ${mediaType}`);
    }
    
    console.log(`Final processed buffer size: ${processedBuffer.length} bytes`);
    
    if (processedBuffer.length > 1000 * 1024) {
      console.warn(`⚠️ Warning: Final size (${processedBuffer.length} bytes) might be too large for WhatsApp`);
    }
    
    const sticker = new Sticker(processedBuffer, {
      pack: options.pack || "xyzbot",
      author: options.author || "xyzuniverse",
      type: StickerTypes.FULL,
      quality: 75, // Reduced from 90 to help with size
    });
    
    return sticker;

  } catch (error) {
    console.error("Error in createSticker:", error);
    throw error;
  } finally {
    // Cleanup
    const filesToClean = [
      tempInputPath,
      tempInputPath + '.gif',
      tempInputPath + '.webp',
      tempInputPath + '.jpg',
      tempInputPath + '.png',
      tempInputPath + '.mp4',
      tempOutputPath
    ];
    
    try {
      const tempFiles = fs.readdirSync(tempDir).filter(f => 
        f.includes(timestamp.toString())
      );
      tempFiles.forEach(f => filesToClean.push(path.join(tempDir, f)));
    } catch (e) { /* ignore */ }
    
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