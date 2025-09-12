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

// Menggunakan metode konversi standar yang lebih stabil
async function simpleConversion(inputPath, outputPath, isVideo = false) {
  console.log("Using simple conversion method...");

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Simple conversion timeout'));
    }, 45000);

    let ffmpegCmd = ffmpeg(inputPath);

    if (isVideo) {
      ffmpegCmd = ffmpegCmd
        .duration(10)
        .outputOptions([
          "-vcodec", "libwebp",
          // Meningkatkan fps dan menurunkan kompresi
          "-vf", "scale='min(512,iw)':-2:force_original_aspect_ratio=decrease,fps=12,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
          "-loop", "0",
          "-an",
          "-compression_level", "3", // Menurunkan level kompresi
          "-qscale", "80"            // Meningkatkan kualitas
        ]);
    } else {
      ffmpegCmd = ffmpegCmd
        .outputOptions([
          "-vcodec", "libwebp",
          "-vf", "scale='min(512,iw)':-2:force_original_aspect_ratio=decrease",
          "-lossless", "0",
          "-qscale", "75"
        ]);
    }

    ffmpegCmd
      .save(outputPath)
      .on("start", (commandLine) => {
        console.log('Simple FFmpeg command:', commandLine);
      })
      .on("end", () => {
        clearTimeout(timeout);
        if (!fs.existsSync(outputPath)) {
          return reject(new Error("Output file was not created."));
        }
        const stats = fs.statSync(outputPath);
        console.log(`Simple conversion completed: ${stats.size} bytes`);
        resolve(stats.size);
      })
      .on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
  });
}

// WEBP SPECIAL HANDLING: berdasarkan pendekatan Anda
async function handleWebPFile(inputPath, outputPath, targetSize = 1024 * 1024) {
  console.log("Special WebP handling...");

  const stats = fs.statSync(inputPath);
  if (stats.size <= targetSize) {
    console.log(`WebP file already small enough (${stats.size} bytes), copying as-is`);
    fs.copyFileSync(inputPath, outputPath);
    return stats.size;
  }

  try {
    return await simpleConversion(inputPath, outputPath, false);
  } catch (conversionError) {
    console.log("WebP processing failed, trying to use original file if not too large");
    if (stats.size < 2 * 1024 * 1024) { // Di bawah 2MB
      console.log("Using original file as a last resort.");
      fs.copyFileSync(inputPath, outputPath);
      return stats.size;
    }
    throw new Error("WebP file is too large and cannot be processed.");
  }
}

function detectMediaType(buffer) {
  if (!buffer || buffer.length === 0) {
    return 'unknown';
  }

  const header = buffer.slice(0, 32);

  // Deteksi TGS telah dihapus di sini

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
    const targetSize = 950 * 1024;

    // Logika konversi TGS telah dihapus di sini

    if (mediaType === 'animated_webp' || mediaType === 'gif' || mediaType === 'video') {
      console.log("Processing as video/animated media...");

      const inputExtension = mediaType === 'gif' ? '.gif' :
        mediaType === 'animated_webp' ? '.webp' : '.mp4';
      const properInputPath = tempInputPath + inputExtension;

      fs.writeFileSync(properInputPath, mediaBuffer);

      try {
        const finalSize = await simpleConversion(properInputPath, tempOutputPath, true);
        processedBuffer = fs.readFileSync(tempOutputPath);
        console.log(`✅ Animated sticker processed successfully: ${finalSize} bytes`);

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
          try {
            // Coba konversi, dan jika berhasil, lanjutkan
            const finalSize = await simpleConversion(properInputPath, tempOutputPath, false);
            processedBuffer = fs.readFileSync(tempOutputPath);
            console.log(`✅ WebP sticker processed successfully: ${finalSize} bytes`);
          } catch (error) {
            // Jika konversi gagal, cek ukuran file asli
            console.warn(`⚠️ Konversi WebP gagal, mencoba menggunakan file asli: ${error.message}`);
            const stats = fs.statSync(properInputPath);
            if (stats.size <= targetSize) {
              fs.copyFileSync(properInputPath, tempOutputPath);
              processedBuffer = fs.readFileSync(tempOutputPath);
              console.log(`✅ Menggunakan file WebP asli yang rusak karena ukurannya memenuhi syarat.`);
            } else {
              // Jika file asli terlalu besar, lemparkan error
              throw new Error("Failed to process corrupted WebP file, and original is too large.");
            }
          }
        } else {
          // Logika untuk jpeg/png seperti sebelumnya
          const finalSize = await simpleConversion(properInputPath, tempOutputPath, false);
          processedBuffer = fs.readFileSync(tempOutputPath);
          console.log(`✅ Static sticker processed successfully: ${finalSize} bytes`);
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
      quality: 75,
    });

    return sticker;

  } catch (error) {
    console.error("Error in createSticker:", error);
    throw error;
  } finally {
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