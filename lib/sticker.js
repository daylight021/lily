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
  const maxFileSize = 800 * 1024; // Reduce to 800KB to ensure it stays under 1MB after processing
  let quality = initialQuality;
  let compression = 6;
  let attempt = 0;
  const maxAttempts = 8; // More attempts
  let finalBuffer = null;

  while (attempt < maxAttempts) {
    console.log(`Compression Attempt ${attempt + 1}/${maxAttempts} - Quality: ${quality}, Compression: ${compression}`);
    
    try {
      const tempCompressPath = `${outputPath}_compress_${attempt}`;
      
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Compression timeout'));
        }, 45000);

        // More aggressive compression settings
        const compressionOptions = [
          "-c:v", "libwebp",
          "-vf", "scale=512:512:force_original_aspect_ratio=decrease",
          "-compression_level", "6",
          "-quality", quality.toString(),
          "-method", "6",
          "-pass", "2",
          "-y"
        ];

        // Add specific options for very small files
        if (attempt > 3) {
          compressionOptions.push(
            "-preset", "picture",
            "-lossless", "0"
          );
        }

        // Even more aggressive for final attempts
        if (attempt > 5) {
          compressionOptions.splice(compressionOptions.indexOf("-vf") + 1, 1, 
            "scale=400:400:force_original_aspect_ratio=decrease"); // Smaller resolution
        }

        ffmpeg(inputPath)
          .outputOptions(compressionOptions)
          .save(tempCompressPath)
          .on("end", () => {
            clearTimeout(timeout);
            resolve();
          })
          .on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
          });
      });

      if (fs.existsSync(tempCompressPath)) {
        const compressedBuffer = fs.readFileSync(tempCompressPath);
        console.log(`Compressed size: ${compressedBuffer.length} bytes (target: ${maxFileSize} bytes)`);
        
        // Clean up temp compress file
        fs.unlinkSync(tempCompressPath);
        
        if (compressedBuffer.length < maxFileSize) {
          // Copy successful compression to output path
          fs.writeFileSync(outputPath, compressedBuffer);
          finalBuffer = compressedBuffer;
          break;
        }
      }
      
      // Adjust parameters more aggressively
      if (attempt < 2) {
        quality = Math.max(quality - 15, 30);
      } else if (attempt < 4) {
        quality = Math.max(quality - 20, 25);
      } else {
        quality = Math.max(quality - 10, 15); // Very low quality for final attempts
      }
      
      compression = Math.min(compression + 1, 6);
      attempt++;
      
    } catch (err) {
      console.error("Compression error:", err.message);
      attempt++;
    }
  }
  
  if (!finalBuffer) {
    console.log("All compression attempts failed, using original with basic compression");
    
    // Last resort: very basic compression
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Final compression timeout'));
        }, 30000);

        ffmpeg(inputPath)
          .outputOptions([
            "-c:v", "libwebp",
            "-vf", "scale=350:350:force_original_aspect_ratio=decrease", // Very small
            "-quality", "20", // Very low quality
            "-method", "6",
            "-compression_level", "6",
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
      
      if (fs.existsSync(outputPath)) {
        finalBuffer = fs.readFileSync(outputPath);
        console.log(`Final resort compression: ${finalBuffer.length} bytes`);
      }
      
    } catch (finalError) {
      console.error("Final compression failed:", finalError.message);
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
      
      // For animated WebP, try alternative approach first
      if (mediaType === 'animated_webp') {
        console.log("Attempting direct WebP to WebP conversion...");
        try {
          const directInputPath = tempInputPath + '.webp';
          fs.writeFileSync(directInputPath, mediaBuffer);
          
          // Try direct conversion with simplified parameters
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Direct WebP conversion timeout'));
            }, 45000);

            ffmpeg(directInputPath)
              .inputOptions(['-t', '10'])
              .outputOptions([
                "-c:v", "libwebp",
                "-vf", "scale=512:512:force_original_aspect_ratio=decrease,fps=10",
                "-compression_level", "6",
                "-quality", "75",
                "-method", "6",
                "-loop", "0",
                "-preset", "default",
                "-y"
              ])
              .save(tempOutputPath)
              .on("start", (cmd) => console.log('Direct WebP FFmpeg:', cmd))
              .on("end", () => {
                clearTimeout(timeout);
                resolve();
              })
              .on("error", (err) => {
                clearTimeout(timeout);
                console.log("Direct WebP conversion failed, trying alternative method...");
                reject(err);
              });
          });

          processedBuffer = fs.readFileSync(tempOutputPath);
          console.log("Direct WebP conversion successful");
          
          // Clean up
          if (fs.existsSync(directInputPath)) {
            fs.unlinkSync(directInputPath);
          }
          
        } catch (directError) {
          console.log("Direct conversion failed, trying alternative approach...");
          
          // Fallback: Convert to PNG frames first, then to WebP
          try {
            const pngFramePath = path.join(tempDir, `frame_${timestamp}_%03d.png`);
            const directInputPath = tempInputPath + '.webp';
            fs.writeFileSync(directInputPath, mediaBuffer);
            
            // Extract frames as PNG
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error('Frame extraction timeout')), 30000);
              
              ffmpeg(directInputPath)
                .outputOptions([
                  "-vf", "scale=512:512:force_original_aspect_ratio=decrease",
                  "-t", "10"
                ])
                .save(pngFramePath)
                .on("end", () => {
                  clearTimeout(timeout);
                  resolve();
                })
                .on("error", (err) => {
                  clearTimeout(timeout);
                  reject(err);
                });
            });
            
            // Convert PNG frames back to animated WebP
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error('Frame reassembly timeout')), 30000);
              
              ffmpeg(pngFramePath)
                .inputOptions(['-framerate', '10'])
                .outputOptions([
                  "-c:v", "libwebp",
                  "-compression_level", "6",
                  "-quality", "70",
                  "-loop", "0",
                  "-y"
                ])
                .save(tempOutputPath)
                .on("end", () => {
                  clearTimeout(timeout);
                  resolve();
                })
                .on("error", (err) => {
                  clearTimeout(timeout);
                  reject(err);
                });
            });
            
            processedBuffer = fs.readFileSync(tempOutputPath);
            
            // Clean up frames
            const frameFiles = fs.readdirSync(tempDir).filter(f => f.startsWith(`frame_${timestamp}_`));
            frameFiles.forEach(f => {
              try {
                fs.unlinkSync(path.join(tempDir, f));
              } catch (e) { /* ignore */ }
            });
            
            if (fs.existsSync(directInputPath)) {
              fs.unlinkSync(directInputPath);
            }
            
          } catch (alternativeError) {
            console.error("All WebP conversion methods failed");
            throw new Error("Animated WebP file is corrupted or unsupported format");
          }
        }
        
      } else {
        // Original method for GIF and video
        const inputExtension = mediaType === 'gif' ? '.gif' : '.mp4';
        const properInputPath = tempInputPath + inputExtension;
        
        fs.writeFileSync(properInputPath, mediaBuffer);
        
        try {
          const metadata = await getMediaMetadata(properInputPath);
          await convertVideoToWebP(properInputPath, tempOutputPath, metadata);
          processedBuffer = fs.readFileSync(tempOutputPath);
          
          if (fs.existsSync(properInputPath)) {
            fs.unlinkSync(properInputPath);
          }
          
        } catch (error) {
          if (fs.existsSync(properInputPath)) {
            fs.unlinkSync(properInputPath);
          }
          throw error;
        }
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
    const maxFileSize = 800 * 1024; // 800KB target, leaves room for wa-sticker-formatter overhead
    console.log(`Initial processed buffer size: ${processedBuffer.length} bytes`);
    
    if (processedBuffer.length > maxFileSize) {
        console.log(`File size ${processedBuffer.length} bytes exceeds limit. Starting compression...`);
        
        // Write current buffer to temp file for compression
        fs.writeFileSync(tempOutputPath, processedBuffer);
        
        const compressedBuffer = await compressSticker(
          tempOutputPath, 
          tempOutputPath, 
          isAnimated ? 75 : 85
        );
        
        if (compressedBuffer && compressedBuffer.length < 900 * 1024) { // 900KB max
            processedBuffer = compressedBuffer;
            console.log(`Successfully compressed to: ${processedBuffer.length} bytes`);
        } else {
            console.warn("Compression failed or still too large, trying final resize...");
            
            // Final attempt with very small size
            try {
              await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Final resize timeout')), 30000);
                
                ffmpeg(tempOutputPath)
                  .outputOptions([
                    "-c:v", "libwebp",
                    "-vf", "scale=300:300:force_original_aspect_ratio=decrease",
                    "-quality", "15",
                    "-method", "6",
                    "-compression_level", "6",
                    "-y"
                  ])
                  .save(tempOutputPath + "_final")
                  .on("end", () => {
                    clearTimeout(timeout);
                    resolve();
                  })
                  .on("error", (err) => {
                    clearTimeout(timeout);
                    reject(err);
                  });
              });
              
              const finalBuffer = fs.readFileSync(tempOutputPath + "_final");
              if (finalBuffer.length < 900 * 1024) {
                processedBuffer = finalBuffer;
                console.log(`Final resize successful: ${processedBuffer.length} bytes`);
              }
              
              // Clean up final temp file
              if (fs.existsSync(tempOutputPath + "_final")) {
                fs.unlinkSync(tempOutputPath + "_final");
              }
              
            } catch (finalError) {
              console.error("Final resize failed:", finalError.message);
              throw new Error("Could not compress sticker to required size limits. Try with a smaller or shorter file.");
            }
        }
    } else {
      console.log("File size acceptable, no compression needed");
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
      tempOutputPath + "_final"
    ];
    
    // Clean up any frame files
    try {
      const frameFiles = fs.readdirSync(tempDir).filter(f => 
        f.startsWith(`frame_${timestamp}_`) || 
        f.includes(`_compress_`) ||
        f.includes(timestamp.toString())
      );
      frameFiles.forEach(f => filesToClean.push(path.join(tempDir, f)));
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
