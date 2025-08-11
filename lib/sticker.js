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

// Function untuk mengkonversi TGS (Lottie) ke WebM/MP4
async function convertTGSToWebM(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    // TGS adalah format Lottie JSON, kita perlu tools khusus
    // Untuk sementara, kita skip TGS dan return error
    reject(new Error("TGS format not supported yet. Please use static stickers or WebM animated stickers."));
  });
}

// Function untuk validasi dan perbaikan file video
async function validateAndFixVideoFile(inputPath, format) {
  try {
    const stats = fs.statSync(inputPath);
    if (stats.size === 0) {
      throw new Error("File kosong");
    }
    
    console.log(`File detected as: ${format}, size: ${stats.size} bytes`);
    
    // Untuk WebM, langsung return true karena biasanya valid
    if (format === 'webm') {
      return true;
    }
    
    // Untuk MP4, coba perbaiki dengan ffmpeg jika rusak
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
        
        // Replace original with fixed version
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

// Function untuk mendapatkan info video dengan support WebM
async function getVideoInfo(inputPath, format) {
  return new Promise((resolve, reject) => {
    console.log(`Getting video info for ${format} file...`);
    
    ffmpeg.ffprobe(inputPath, ['-v', 'error', '-select_streams', 'v:0', 
                               '-show_entries', 'stream=width,height,duration,codec_name', 
                               '-of', 'csv=p=0'], (err, metadata) => {
      if (err) {
        console.error("FFprobe error:", err.message);
        
        // Fallback values based on format
        const fallbackInfo = {
          streams: [{
            codec_type: "video",
            width: format === 'webm' ? 384 : 512,
            height: format === 'webm' ? 384 : 512,
            duration: 3,
            codec_name: format === 'webm' ? 'vp8' : 'h264'
          }]
        };
        
        console.log("Using fallback video info:", fallbackInfo.streams[0]);
        resolve(fallbackInfo);
      } else {
        console.log("Video info retrieved successfully");
        resolve(metadata);
      }
    });
  });
}

async function convertToWebP(inputPath, outputPath, width, height, duration, format, preserveTransparency = true) {
  return new Promise((resolve, reject) => {
    const validDuration = Number.isFinite(duration) && duration > 0 ? Math.min(duration, 8) : 3;
    
    console.log(`Converting ${format} to WebP: ${width}x${height}, duration: ${validDuration}s, transparent: ${preserveTransparency}`);
    
    // Filter untuk berbagai format input
    let videoFilters = [];
    
    // Scale and maintain aspect ratio
    videoFilters.push(`scale=384:384:force_original_aspect_ratio=decrease`);
    
    // Pad dengan background transparan atau putih
    if (preserveTransparency) {
      videoFilters.push(`pad=384:384:(ow-iw)/2:(oh-ih)/2:color=0x00000000`);
    } else {
      videoFilters.push(`pad=384:384:(ow-iw)/2:(oh-ih)/2:color=white`);
    }
    
    // Set frame rate
    videoFilters.push(`fps=8`); // Lebih rendah untuk ukuran file lebih kecil
    
    const filterComplex = videoFilters.join(',');
    
    let command = ffmpeg(inputPath)
      .duration(validDuration)
      .outputOptions([
        '-vcodec', 'libwebp',
        '-vf', filterComplex,
        '-loop', '0',
        '-an', // No audio
        '-vsync', '0'
      ]);

    // Options berdasarkan format input dan transparency
    if (format === 'webm' && preserveTransparency) {
      // WebM sudah support transparency, optimize untuk itu
      command = command.outputOptions([
        '-pix_fmt', 'yuva420p',
        '-lossless', '0',
        '-quality', '80',
        '-method', '4'
      ]);
    } else if (preserveTransparency) {
      // Format lain yang ingin transparency
      command = command.outputOptions([
        '-pix_fmt', 'yuva420p',
        '-lossless', '0',
        '-quality', '75',
        '-method', '6'
      ]);
    } else {
      // No transparency needed
      command = command.outputOptions([
        '-quality', '85',
        '-compression_level', '4'
      ]);
    }

    command
      .save(outputPath)
      .on('start', (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          console.log(`Conversion progress: ${Math.round(progress.percent)}%`);
        }
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

// Function untuk membuat sticker dari WebP static (fallback)
async function createStaticWebPFallback(inputBuffer, options) {
  console.log("Creating static WebP sticker fallback...");
  
  try {
    // Langsung gunakan buffer jika sudah WebP static
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
    console.error("Static WebP fallback creation failed:", error);
    throw error;
  }
}

async function createStickerFromVideo(videoBuffer, options = {}) {
  console.log(`Starting video sticker creation, buffer size: ${videoBuffer.length} bytes`);
  
  // Validasi buffer
  if (!videoBuffer || videoBuffer.length === 0) {
    throw new Error("Video buffer kosong atau tidak valid");
  }

  if (videoBuffer.length < 100) {
    throw new Error("Video buffer terlalu kecil, kemungkinan file rusak");
  }

  // Deteksi format file
  const detectedFormat = detectFileFormat(videoBuffer);
  console.log(`Detected file format: ${detectedFormat}`);

  // Handle TGS format (Telegram animated sticker)
  if (detectedFormat === 'tgs') {
    throw new Error("TGS animated stickers are not supported yet. Please use WebM animated stickers.");
  }

  // Handle static WebP
  if (detectedFormat === 'webp') {
    console.log("Detected static WebP, creating static sticker...");
    return await createStaticWebPFallback(videoBuffer, options);
  }

  // Handle image formats
  if (['png', 'jpeg'].includes(detectedFormat)) {
    console.log(`Detected static image (${detectedFormat}), creating static sticker...`);
    return await createStaticWebPFallback(videoBuffer, options);
  }

  // Pastikan direktori temp ada
  const tempDir = path.join(__dirname, "../temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Gunakan ekstensi yang sesuai dengan format yang terdeteksi
  const fileExt = detectedFormat === 'webm' ? '.webm' : '.mp4';
  const tempInputPath = path.join(tempDir, `vid_input_${Date.now()}${fileExt}`);
  const tempOutputPath = path.join(tempDir, `vid_output_${Date.now()}.webp`);

  // Write buffer to file
  try {
    fs.writeFileSync(tempInputPath, videoBuffer);
    console.log(`Temporary video file created: ${tempInputPath}`);
  } catch (writeError) {
    throw new Error(`Gagal menulis file temporary: ${writeError.message}`);
  }

  let webpBuffer = null;
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts && !webpBuffer) {
    try {
      console.log(`Attempt ${attempts + 1} of ${maxAttempts} for ${detectedFormat}`);
      
      // Validasi dan perbaiki file jika perlu
      const isValid = await validateAndFixVideoFile(tempInputPath, detectedFormat);
      if (!isValid && attempts === 0) {
        console.log("File validation failed, but continuing with conversion attempt...");
      }
      
      // Get video info
      let videoInfo;
      try {
        videoInfo = await getVideoInfo(tempInputPath, detectedFormat);
      } catch (infoError) {
        console.error("Failed to get video info:", infoError);
        
        if (attempts === maxAttempts - 1) {
          // Last attempt, try static fallback
          console.log("All attempts failed, trying to treat as static image...");
          try {
            return await createStaticWebPFallback(videoBuffer, options);
          } catch (staticError) {
            throw new Error(`Cannot process as video or static image: ${infoError.message}`);
          }
        }
        
        attempts++;
        continue;
      }

      const videoStream = videoInfo.streams.find(s => s.codec_type === "video");
      
      if (!videoStream) {
        throw new Error("No video stream found");
      }

      const width = videoStream.width || 384;
      const height = videoStream.height || 384;
      const duration = parseFloat(videoStream.duration) || 3;
      
      console.log(`Video info - Width: ${width}, Height: ${height}, Duration: ${duration}s, Codec: ${videoStream.codec_name}`);

      const preserveTransparency = options.preserveTransparency !== false;
      
      // Convert to WebP
      await convertToWebP(tempInputPath, tempOutputPath, width, height, duration, detectedFormat, preserveTransparency);
      
      // Check if output file exists and is valid
      if (fs.existsSync(tempOutputPath)) {
        const stats = fs.statSync(tempOutputPath);
        if (stats.size > 0) {
          webpBuffer = fs.readFileSync(tempOutputPath);
          console.log(`WebP created successfully: ${webpBuffer.length} bytes`);
          break;
        } else {
          throw new Error("Output WebP file is empty");
        }
      } else {
        throw new Error("Output WebP file was not created");
      }

    } catch (error) {
      console.error(`Attempt ${attempts + 1} failed:`, error.message);
      
      if (attempts === maxAttempts - 1) {
        // Last attempt failed, try static fallback
        console.log("All video conversion attempts failed, trying static fallback...");
        try {
          return await createStaticWebPFallback(videoBuffer, options);
        } catch (fallbackError) {
          throw new Error(`Video conversion failed and static fallback failed: ${error.message}`);
        }
      }
    }
    
    attempts++;
    
    // Clean up output file for retry
    try {
      if (fs.existsSync(tempOutputPath)) {
        fs.unlinkSync(tempOutputPath);
      }
    } catch (e) {}
    
    // Wait a bit before retry
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (!webpBuffer) {
    throw new Error("Failed to create sticker after all attempts");
  }

  // Create sticker dengan WebP buffer
  const stickerOptions = {
    pack: options.pack || "Bot Stiker",
    author: options.author || "Telegram Import",
    type: StickerTypes.FULL,
    quality: 75,
    background: options.preserveTransparency !== false ? 'transparent' : undefined
  };

  try {
    const sticker = new Sticker(webpBuffer, stickerOptions);
    
    // Cleanup temp files
    try {
      if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
      if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
    } catch (cleanupError) {
      console.error("Error cleaning up temp files:", cleanupError);
    }

    console.log(`Sticker created successfully from ${detectedFormat} format`);
    return sticker;
    
  } catch (stickerError) {
    console.error("Error creating sticker from WebP:", stickerError);
    throw new Error(`Gagal membuat sticker: ${stickerError.message}`);
  }
}

module.exports = { createStickerFromVideo };
