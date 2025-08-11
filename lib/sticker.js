const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const { Sticker, StickerTypes } = require("wa-sticker-formatter");
const { execSync } = require('child_process');

// Function untuk validasi file video
function validateVideoFile(filePath) {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      throw new Error("File kosong");
    }
    
    // Baca beberapa byte pertama untuk validasi format
    const buffer = fs.readFileSync(filePath, { start: 0, end: 11 });
    const header = buffer.toString('hex');
    
    // Check untuk format video yang umum
    const videoFormats = [
      '000000', // MP4
      '66747970', // MP4 ftyp
      '1a45dfa3', // WebM
      '52494646', // AVI
      '464c5601', // FLV
    ];
    
    const isValidVideo = videoFormats.some(format => 
      header.toLowerCase().includes(format.toLowerCase())
    );
    
    if (!isValidVideo) {
      console.log(`Warning: File might not be a valid video format. Header: ${header}`);
    }
    
    return true;
  } catch (error) {
    console.error("File validation error:", error);
    return false;
  }
}

// Function untuk mendapatkan info video dengan error handling yang lebih baik
async function getVideoInfo(inputPath) {
  return new Promise((resolve, reject) => {
    // Validasi file terlebih dahulu
    if (!validateVideoFile(inputPath)) {
      reject(new Error("Invalid video file"));
      return;
    }

    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        console.error("FFprobe error details:", {
          message: err.message,
          code: err.code,
          killed: err.killed,
          signal: err.signal
        });
        
        // Coba gunakan fallback method
        try {
          console.log("Trying fallback method for video info...");
          // Gunakan ffmpeg untuk mendapatkan info dasar
          resolve({
            streams: [{
              codec_type: "video",
              width: 512,
              height: 512,
              duration: 3, // Default 3 detik
              codec_name: "unknown"
            }]
          });
        } catch (fallbackError) {
          reject(new Error(`FFprobe failed and fallback failed: ${err.message}`));
        }
      } else {
        resolve(metadata);
      }
    });
  });
}

async function convertWebP(inputPath, outputPath, width, height, duration, quality = 85, compression = 3, preserveTransparency = true) {
  return new Promise((resolve, reject) => {
    const validDuration = Number.isFinite(duration) && duration > 0 ? Math.min(duration, 10) : 3;
    
    console.log(`Converting video: ${width}x${height}, duration: ${validDuration}s, transparent: ${preserveTransparency}`);
    
    // Filter untuk sticker animasi dengan transparency
    let videoFilters = [];
    
    // Scale dan maintain aspect ratio
    videoFilters.push(`scale=384:384:force_original_aspect_ratio=decrease`);
    
    // Pad untuk membuat ukuran persegi dengan background transparan
    if (preserveTransparency) {
      videoFilters.push(`pad=384:384:(ow-iw)/2:(oh-ih)/2:color=0x00000000`);
    } else {
      videoFilters.push(`pad=384:384:(ow-iw)/2:(oh-ih)/2:color=white`);
    }
    
    // Set frame rate untuk sticker
    videoFilters.push(`fps=10`);
    
    const filterComplex = videoFilters.join(',');
    
    let command = ffmpeg(inputPath)
      .duration(validDuration)
      .outputOptions([
        '-vcodec', 'libwebp',
        '-vf', filterComplex,
        '-loop', '0',
        '-preset', 'default',
        '-an', // No audio
        '-vsync', '0'
      ]);

    // Options berdasarkan transparency requirement
    if (preserveTransparency) {
      command = command.outputOptions([
        '-pix_fmt', 'yuva420p', // Format dengan alpha channel
        '-lossless', '0', // Tidak lossless untuk ukuran lebih kecil
        '-quality', '75',
        '-method', '6' // Compression method
      ]);
    } else {
      command = command.outputOptions([
        '-quality', quality.toString(),
        '-compression_level', compression.toString()
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
        console.log('Conversion completed successfully');
        resolve();
      })
      .on('error', (err) => {
        console.error('FFmpeg conversion error:', err);
        reject(err);
      });
  });
}

// Function untuk membuat fallback sticker static jika animated gagal
async function createStaticFallback(videoBuffer, options) {
  console.log("Creating static fallback sticker...");
  
  const tempDir = path.join(__dirname, "../temp");
  const tempInputPath = path.join(tempDir, `static_input_${Date.now()}.mp4`);
  const tempOutputPath = path.join(tempDir, `static_output_${Date.now()}.png`);

  fs.writeFileSync(tempInputPath, videoBuffer);

  try {
    // Extract first frame as PNG with transparency
    await new Promise((resolve, reject) => {
      ffmpeg(tempInputPath)
        .seekInput(0)
        .frames(1)
        .outputOptions([
          '-vf', 'scale=384:384:force_original_aspect_ratio=decrease,pad=384:384:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
          '-pix_fmt', 'rgba'
        ])
        .save(tempOutputPath)
        .on('end', resolve)
        .on('error', reject);
    });

    if (fs.existsSync(tempOutputPath)) {
      const imageBuffer = fs.readFileSync(tempOutputPath);
      
      const stickerOptions = {
        pack: options.pack || "Bot Stiker",
        author: options.author || "Telegram Import",
        type: StickerTypes.FULL,
        quality: 90,
        background: 'transparent'
      };

      const sticker = new Sticker(imageBuffer, stickerOptions);
      
      // Cleanup
      try {
        fs.unlinkSync(tempInputPath);
        fs.unlinkSync(tempOutputPath);
      } catch (e) {}

      return sticker;
    }
  } catch (error) {
    console.error("Static fallback creation failed:", error);
    throw error;
  } finally {
    // Cleanup
    try {
      if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
      if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
    } catch (e) {}
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

  // Pastikan direktori temp ada
  const tempDir = path.join(__dirname, "../temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempInputPath = path.join(tempDir, `vid_input_${Date.now()}.mp4`);
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
      console.log(`Attempt ${attempts + 1} of ${maxAttempts}`);
      
      // Get video info dengan error handling
      let videoInfo;
      try {
        videoInfo = await getVideoInfo(tempInputPath);
      } catch (infoError) {
        console.error("Failed to get video info:", infoError);
        
        if (attempts === maxAttempts - 1) {
          // Last attempt, try static fallback
          console.log("Trying static fallback...");
          const fallbackSticker = await createStaticFallback(videoBuffer, options);
          return fallbackSticker;
        }
        
        attempts++;
        continue;
      }

      const videoStream = videoInfo.streams.find(s => s.codec_type === "video");
      
      if (!videoStream) {
        throw new Error("No video stream found");
      }

      const width = videoStream.width || 512;
      const height = videoStream.height || 512;
      const duration = parseFloat(videoStream.duration) || 3;
      
      console.log(`Video info - Width: ${width}, Height: ${height}, Duration: ${duration}s`);

      const preserveTransparency = options.preserveTransparency !== false;
      
      // Convert to WebP
      await convertWebP(tempInputPath, tempOutputPath, width, height, duration, 75, 6, preserveTransparency);
      
      // Check if output file exists and is valid
      if (fs.existsSync(tempOutputPath)) {
        const stats = fs.statSync(tempOutputPath);
        if (stats.size > 0) {
          webpBuffer = fs.readFileSync(tempOutputPath);
          console.log(`WebP created successfully: ${webpBuffer.length} bytes`);
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
        console.log("All animated conversion attempts failed, trying static fallback...");
        try {
          const fallbackSticker = await createStaticFallback(videoBuffer, options);
          return fallbackSticker;
        } catch (fallbackError) {
          throw new Error(`Animated conversion failed and static fallback failed: ${error.message}`);
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

    return sticker;
  } catch (stickerError) {
    console.error("Error creating sticker from WebP:", stickerError);
    throw new Error(`Gagal membuat sticker: ${stickerError.message}`);
  }
}

module.exports = { createStickerFromVideo };