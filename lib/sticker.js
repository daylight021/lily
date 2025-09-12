const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const { Sticker, StickerTypes } = require("wa-sticker-formatter");

function ensureTempDir() {
  const tempDir = path.join(__dirname, "../temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

// Fungsi konversi yang diperbaiki untuk menghindari artefak
async function optimizedConversion(inputPath, outputPath, isVideo = false) {
  console.log("Using optimized conversion method...");

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Conversion timeout'));
    }, 60000); // Increased timeout

    let ffmpegCmd = ffmpeg(inputPath);

    if (isVideo) {
      // Untuk video/animasi - menggunakan libwebp_anim dan filter yang diperbaiki
      ffmpegCmd = ffmpegCmd
        .duration(10) // Maksimal 10 detik
        .outputOptions([
          "-c:v", "libwebp_anim", // Codec yang benar untuk animated WebP
          "-vf", "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:-1:-1:color=white@0.0,fps=15", // Filter yang diperbaiki
          "-loop", "0",
          "-an", // No audio
          "-preset", "default",
          "-lossless", "0",
          "-compression_level", "4",
          "-qscale", "75",
          "-method", "4"
        ]);
    } else {
      // Untuk gambar statis
      ffmpegCmd = ffmpegCmd
        .outputOptions([
          "-c:v", "libwebp",
          "-vf", "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:-1:-1:color=white@0.0",
          "-lossless", "0",
          "-qscale", "75",
          "-preset", "default",
          "-compression_level", "4"
        ]);
    }

    ffmpegCmd
      .save(outputPath)
      .on("start", (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on("end", () => {
        clearTimeout(timeout);
        if (!fs.existsSync(outputPath)) {
          return reject(new Error("Output file was not created."));
        }
        const stats = fs.statSync(outputPath);
        console.log(`Conversion completed: ${stats.size} bytes`);
        resolve(stats.size);
      })
      .on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
  });
}

// Fungsi fallback untuk file yang sulit dikonversi
async function fallbackConversion(inputPath, outputPath, isVideo = false) {
  console.log("Using fallback conversion method...");

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Fallback conversion timeout'));
    }, 45000);

    let ffmpegCmd = ffmpeg(inputPath);

    if (isVideo) {
      ffmpegCmd = ffmpegCmd
        .duration(8) // Durasi lebih pendek untuk file bermasalah
        .outputOptions([
          "-c:v", "libwebp",
          "-vf", "scale=480:480:force_original_aspect_ratio=decrease,fps=10", // Lebih sederhana
          "-loop", "0",
          "-an",
          "-lossless", "0",
          "-qscale", "50", // Kompresi sedang
          "-preset", "default",
          "-compression_level", "4"
        ]);
    } else {
      ffmpegCmd = ffmpegCmd
        .outputOptions([
          "-c:v", "libwebp",
          "-vf", "scale=480:480:force_original_aspect_ratio=decrease",
          "-lossless", "0",
          "-qscale", "50"
        ]);
    }

    ffmpegCmd
      .save(outputPath)
      .on("start", (commandLine) => {
        console.log('Fallback FFmpeg command:', commandLine);
      })
      .on("end", () => {
        clearTimeout(timeout);
        if (!fs.existsSync(outputPath)) {
          return reject(new Error("Output file was not created."));
        }
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

// Fungsi untuk mengecek dan mengompres file jika terlalu besar
async function ensureFileSizeLimit(filePath, maxSize = 950 * 1024) {
  const stats = fs.statSync(filePath);
  
  if (stats.size <= maxSize) {
    return stats.size;
  }

  console.log(`File too large (${stats.size} bytes), applying additional compression...`);
  
  const tempPath = filePath + '_temp';
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Size reduction timeout'));
    }, 30000);

    ffmpeg(filePath)
      .outputOptions([
        "-c:v", "libwebp",
        "-qscale", "40", // Kompresi lebih agresif
        "-preset", "default",
        "-compression_level", "6"
      ])
      .save(tempPath)
      .on("end", () => {
        clearTimeout(timeout);
        try {
          const newStats = fs.statSync(tempPath);
          fs.unlinkSync(filePath);
          fs.renameSync(tempPath, filePath);
          console.log(`File compressed to ${newStats.size} bytes`);
          resolve(newStats.size);
        } catch (error) {
          reject(error);
        }
      })
      .on("error", (err) => {
        clearTimeout(timeout);
        if (fs.existsSync(tempPath)) {
          try { fs.unlinkSync(tempPath); } catch (e) {}
        }
        reject(err);
      });
  });
}

function detectMediaType(buffer) {
  if (!buffer || buffer.length === 0) {
    return 'unknown';
  }

  const header = buffer.slice(0, 32);

  // JPEG detection
  if (header[0] === 0xFF && header[1] === 0xD8) return 'jpeg';

  // PNG detection
  if (header.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47]))) return 'png';

  // WebP detection with animation check
  if (buffer.includes(Buffer.from('RIFF')) && buffer.includes(Buffer.from('WEBP'))) {
    if (buffer.includes(Buffer.from('ANIM')) || buffer.includes(Buffer.from('ANMF'))) {
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
    throw new Error('File size too large (max 15MB)');
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
    const maxSizeBytes = 950 * 1024; // Target maksimal di bawah 1MB

    if (mediaType === 'animated_webp' || mediaType === 'gif' || mediaType === 'video') {
      console.log("Processing as animated media...");

      const inputExtension = mediaType === 'gif' ? '.gif' :
        mediaType === 'animated_webp' ? '.webp' : '.mp4';
      const properInputPath = tempInputPath + inputExtension;

      fs.writeFileSync(properInputPath, mediaBuffer);

      try {
        // Coba metode optimized dulu
        let finalSize = await optimizedConversion(properInputPath, tempOutputPath, true);
        
        // Jika masih terlalu besar, kompres lagi
        if (finalSize > maxSizeBytes) {
          finalSize = await ensureFileSizeLimit(tempOutputPath, maxSizeBytes);
        }
        
        processedBuffer = fs.readFileSync(tempOutputPath);
        console.log(`✅ Animated sticker processed successfully: ${finalSize} bytes`);

      } catch (error) {
        console.warn(`⚠️ Optimized conversion failed, trying fallback: ${error.message}`);
        
        try {
          // Coba metode fallback
          let finalSize = await fallbackConversion(properInputPath, tempOutputPath, true);
          
          if (finalSize > maxSizeBytes) {
            finalSize = await ensureFileSizeLimit(tempOutputPath, maxSizeBytes);
          }
          
          processedBuffer = fs.readFileSync(tempOutputPath);
          console.log(`✅ Animated sticker processed with fallback: ${finalSize} bytes`);
          
        } catch (fallbackError) {
          console.error("Both conversion methods failed:", fallbackError);
          throw new Error(`Failed to convert animated media: ${fallbackError.message}`);
        }
      }

      if (fs.existsSync(properInputPath)) {
        fs.unlinkSync(properInputPath);
      }

    } else if (mediaType === 'webp' || mediaType === 'jpeg' || mediaType === 'png') {
      console.log("Processing as static image...");

      const inputExtension = mediaType === 'jpeg' ? '.jpg' :
        mediaType === 'png' ? '.png' : '.webp';
      const properInputPath = tempInputPath + inputExtension;

      fs.writeFileSync(properInputPath, mediaBuffer);

      try {
        if (mediaType === 'webp') {
          // Untuk WebP, cek dulu ukuran asli
          const stats = fs.statSync(properInputPath);
          if (stats.size <= maxSizeBytes) {
            console.log(`WebP already small enough (${stats.size} bytes), using as-is`);
            fs.copyFileSync(properInputPath, tempOutputPath);
            processedBuffer = fs.readFileSync(tempOutputPath);
          } else {
            // Perlu dikonversi
            let finalSize = await optimizedConversion(properInputPath, tempOutputPath, false);
            if (finalSize > maxSizeBytes) {
              finalSize = await ensureFileSizeLimit(tempOutputPath, maxSizeBytes);
            }
            processedBuffer = fs.readFileSync(tempOutputPath);
            console.log(`✅ WebP sticker processed: ${finalSize} bytes`);
          }
        } else {
          // Untuk JPEG/PNG
          let finalSize = await optimizedConversion(properInputPath, tempOutputPath, false);
          if (finalSize > maxSizeBytes) {
            finalSize = await ensureFileSizeLimit(tempOutputPath, maxSizeBytes);
          }
          processedBuffer = fs.readFileSync(tempOutputPath);
          console.log(`✅ Static sticker processed: ${finalSize} bytes`);
        }

      } catch (error) {
        console.error(`Failed to process ${mediaType}:`, error);
        throw new Error(`Failed to process ${mediaType}: ${error.message}`);
      }

      if (fs.existsSync(properInputPath)) {
        fs.unlinkSync(properInputPath);
      }
    } else {
      throw new Error(`Unsupported media type: ${mediaType}`);
    }

    console.log(`Final processed buffer size: ${processedBuffer.length} bytes`);

    if (processedBuffer.length > 1000 * 1024) {
      console.warn(`⚠️ Warning: Final size (${processedBuffer.length} bytes) might be too large for WhatsApp mobile`);
    } else {
      console.log(`✅ File size OK for WhatsApp mobile: ${processedBuffer.length} bytes`);
    }

    const sticker = new Sticker(processedBuffer, {
      pack: options.pack || "xyzbot",
      author: options.author || "xyzuniverse",
      type: StickerTypes.FULL,
      quality: 75,
    });

    return sticker;

  } catch (error) {
    console.error("Error in createSticker:", error);
    throw error;
  } finally {
    // Cleanup semua file temporary
    const filesToClean = [
      tempInputPath,
      tempInputPath + '.gif',
      tempInputPath + '.webp', 
      tempInputPath + '.jpg',
      tempInputPath + '.png',
      tempInputPath + '.mp4',
      tempOutputPath,
      tempOutputPath + '_temp'
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