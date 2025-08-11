const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const { Sticker, StickerTypes } = require("wa-sticker-formatter");
const zlib = require('zlib');

const TEMP_DIR = path.join(__dirname, "../temp");

// Function untuk deteksi format file berdasarkan header
function detectFileFormat(buffer) {
  if (!buffer || buffer.length < 12) {
    return 'unknown';
  }
  
  const header = buffer.toString('hex', 0, 12).toLowerCase();
  
  if (header.startsWith('1a45dfa3')) {
    return 'webm';
  }
  
  if (header.includes('66747970') || header.startsWith('000000') || 
      header.includes('6d6f6f76') || header.includes('6d646174')) {
    return 'mp4';
  }
  
  // Perbaikan: Deteksi TGS. Stiker TGS seringkali GZIP-compressed,
  // sehingga header awalnya bukan JSON.
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
      return 'tgs-compressed';
  }
  if (buffer.toString('utf8', 0, 10).includes('{') || 
      buffer.toString('utf8', 0, 10).includes('{"')) {
    return 'tgs';
  }
  
  if (header.includes('52494646') && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp';
  }
  
  if (header.startsWith('89504e47')) {
    return 'png';
  }
  
  if (header.startsWith('ffd8ff')) {
    return 'jpeg';
  }
  
  return 'unknown';
}

// Solusi 1: Menggunakan puppeteer dengan lottie-player (Recommended)
async function createStickerFromTGSPuppeteer(tgsBuffer, options) {
  let browser;
  try {
    const puppeteer = require('puppeteer');
    
    // Decompress jika GZIP
    let processedBuffer = tgsBuffer;
    if (tgsBuffer[0] === 0x1f && tgsBuffer[1] === 0x8b) {
      processedBuffer = zlib.gunzipSync(tgsBuffer);
    }
    
    // Parse JSON untuk validasi
    const animationData = JSON.parse(processedBuffer.toString('utf8'));
    
    // Launch browser
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 512, height: 512 });
    
    // HTML dengan lottie-player
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <script src="https://unpkg.com/@lottiefiles/lottie-player@latest/dist/lottie-player.js"></script>
        <style>
            body { margin: 0; padding: 0; background: transparent; }
            lottie-player { width: 512px; height: 512px; }
        </style>
    </head>
    <body>
        <lottie-player id="lottie" autoplay loop style="width: 512px; height: 512px;"></lottie-player>
        <script>
            const animationData = ${JSON.stringify(animationData)};
            const player = document.getElementById('lottie');
            player.load(animationData);
        </script>
    </body>
    </html>`;
    
    await page.setContent(html);
    await page.waitForTimeout(2000); // Wait for animation to load
    
    // Capture frames
    const frameCount = 15; // 15 frames for animation
    const frames = [];
    
    for (let i = 0; i < frameCount; i++) {
      const frameBuffer = await page.screenshot({
        type: 'png',
        omitBackground: true // Important for transparency
      });
      
      const framePath = path.join(TEMP_DIR, `tgs_frame_${Date.now()}_${i}.png`);
      fs.writeFileSync(framePath, frameBuffer);
      frames.push(framePath);
      
      await page.waitForTimeout(100); // Wait between frames
    }
    
    await browser.close();
    browser = null;
    
    // Convert frames to WebP using FFmpeg
    const tempWebpPath = path.join(TEMP_DIR, `tgs_output_${Date.now()}.webp`);
    
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(`${path.join(TEMP_DIR, 'tgs_frame_' + Date.now().toString().slice(0, -1))}*.png`)
        .inputFPS(15)
        .outputOptions([
          '-vcodec', 'libwebp',
          '-vf', 'scale=512:512',
          '-loop', '0',
          '-lossless', '0',
          '-quality', '80',
          '-method', '6'
        ])
        .output(tempWebpPath)
        .on('end', () => {
          // Cleanup frame files
          frames.forEach(frame => {
            if (fs.existsSync(frame)) fs.unlinkSync(frame);
          });
          
          try {
            const webpBuffer = fs.readFileSync(tempWebpPath);
            fs.unlinkSync(tempWebpPath);
            
            const sticker = new Sticker(webpBuffer, {
              ...options,
              background: 'transparent'
            });
            resolve(sticker);
          } catch (err) {
            reject(err);
          }
        })
        .on('error', (err) => {
          // Cleanup on error
          frames.forEach(frame => {
            if (fs.existsSync(frame)) fs.unlinkSync(frame);
          });
          reject(err);
        })
        .run();
    });
    
  } catch (error) {
    if (browser) await browser.close();
    throw error;
  }
}

// Solusi 2: Menggunakan rlottie CLI (jika tersedia)
async function createStickerFromTGSRlottie(tgsBuffer, options) {
  return new Promise(async (resolve, reject) => {
    const { exec } = require('child_process');
    const tempTgsPath = path.join(TEMP_DIR, `tgs_input_${Date.now()}.json`);
    const tempWebpPath = path.join(TEMP_DIR, `tgs_output_${Date.now()}.webp`);
    
    try {
      // Decompress jika GZIP
      let processedBuffer = tgsBuffer;
      if (tgsBuffer[0] === 0x1f && tgsBuffer[1] === 0x8b) {
        processedBuffer = zlib.gunzipSync(tgsBuffer);
      }
      
      // Write JSON file
      fs.writeFileSync(tempTgsPath, processedBuffer);
      
      // Check if rlottie_gif exists
      exec('which rlottie_gif', (error, stdout, stderr) => {
        if (error) {
          // rlottie not available, use FFmpeg method
          ffmpeg()
            .input(tempTgsPath)
            .inputOptions(['-f', 'lottie'])
            .outputOptions([
              '-vcodec', 'libwebp',
              '-vf', 'scale=512:512:flags=lanczos,fps=15,format=rgba',
              '-loop', '0',
              '-lossless', '0',
              '-quality', '80',
              '-method', '6',
              '-t', '3'
            ])
            .output(tempWebpPath)
            .on('end', () => {
              try {
                if (fs.existsSync(tempTgsPath)) fs.unlinkSync(tempTgsPath);
                
                const webpBuffer = fs.readFileSync(tempWebpPath);
                if (fs.existsSync(tempWebpPath)) fs.unlinkSync(tempWebpPath);
                
                const sticker = new Sticker(webpBuffer, {
                  ...options,
                  background: 'transparent'
                });
                resolve(sticker);
              } catch (err) {
                reject(err);
              }
            })
            .on('error', (err) => {
              if (fs.existsSync(tempTgsPath)) fs.unlinkSync(tempTgsPath);
              if (fs.existsSync(tempWebpPath)) fs.unlinkSync(tempWebpPath);
              reject(err);
            })
            .run();
        } else {
          // Use rlottie_gif
          const tempGifPath = path.join(TEMP_DIR, `tgs_gif_${Date.now()}.gif`);
          
          exec(`rlottie_gif ${tempTgsPath} ${tempGifPath} 512 512`, (rlottieError, rlottieStdout, rlottieStderr) => {
            if (rlottieError) {
              reject(rlottieError);
              return;
            }
            
            // Convert GIF to WebP
            ffmpeg(tempGifPath)
              .outputOptions([
                '-vcodec', 'libwebp',
                '-loop', '0',
                '-lossless', '0',
                '-quality', '80'
              ])
              .output(tempWebpPath)
              .on('end', () => {
                // Cleanup
                [tempTgsPath, tempGifPath].forEach(file => {
                  if (fs.existsSync(file)) fs.unlinkSync(file);
                });
                
                try {
                  const webpBuffer = fs.readFileSync(tempWebpPath);
                  fs.unlinkSync(tempWebpPath);
                  
                  const sticker = new Sticker(webpBuffer, {
                    ...options,
                    background: 'transparent'
                  });
                  resolve(sticker);
                } catch (err) {
                  reject(err);
                }
              })
              .on('error', (err) => {
                [tempTgsPath, tempGifPath, tempWebpPath].forEach(file => {
                  if (fs.existsSync(file)) fs.unlinkSync(file);
                });
                reject(err);
              })
              .run();
          });
        }
      });
      
    } catch (error) {
      if (fs.existsSync(tempTgsPath)) fs.unlinkSync(tempTgsPath);
      reject(error);
    }
  });
}

// Solusi 3: Menggunakan Python lottie converter sebagai fallback
async function createStickerFromTGSPython(tgsBuffer, options) {
  return new Promise(async (resolve, reject) => {
    const { exec } = require('child_process');
    const tempTgsPath = path.join(TEMP_DIR, `tgs_input_${Date.now()}.tgs`);
    const tempWebpPath = path.join(TEMP_DIR, `tgs_output_${Date.now()}.webp`);
    
    try {
      // Decompress jika GZIP
      let processedBuffer = tgsBuffer;
      if (tgsBuffer[0] === 0x1f && tgsBuffer[1] === 0x8b) {
        processedBuffer = zlib.gunzipSync(tgsBuffer);
      }
      
      fs.writeFileSync(tempTgsPath, processedBuffer);
      
      // Try using lottie-converter (Python)
      exec(`lottie_convert.py ${tempTgsPath} ${tempWebpPath} --format webp --width 512 --height 512`, 
        (error, stdout, stderr) => {
          if (error) {
            if (fs.existsSync(tempTgsPath)) fs.unlinkSync(tempTgsPath);
            reject(error);
            return;
          }
          
          try {
            if (fs.existsSync(tempTgsPath)) fs.unlinkSync(tempTgsPath);
            
            const webpBuffer = fs.readFileSync(tempWebpPath);
            if (fs.existsSync(tempWebpPath)) fs.unlinkSync(tempWebpPath);
            
            const sticker = new Sticker(webpBuffer, {
              ...options,
              background: 'transparent'
            });
            resolve(sticker);
          } catch (err) {
            reject(err);
          }
        });
        
    } catch (error) {
      if (fs.existsSync(tempTgsPath)) fs.unlinkSync(tempTgsPath);
      reject(error);
    }
  });
}

// Main function untuk TGS conversion dengan multiple fallbacks
async function createStickerFromTGS(tgsBuffer, options) {
  // Try methods in order of reliability
  const methods = [
    { name: 'Puppeteer + Lottie Player', func: createStickerFromTGSPuppeteer },
    { name: 'RLottie/FFmpeg', func: createStickerFromTGSRlottie },
    { name: 'Python Lottie Converter', func: createStickerFromTGSPython }
  ];
  
  for (const method of methods) {
    try {
      console.log(`Trying TGS conversion method: ${method.name}`);
      const result = await method.func(tgsBuffer, options);
      console.log(`TGS conversion successful with: ${method.name}`);
      return result;
    } catch (error) {
      console.log(`TGS conversion failed with ${method.name}: ${error.message}`);
      continue;
    }
  }
  
  // All methods failed
  throw new Error("All TGS conversion methods failed");
}

// Fungsi untuk mendapatkan info video
async function getVideoInfo(inputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(inputPath, (err, metadata) => {
            if (err) {
                console.error("FFprobe error:", err.message);
                reject(new Error("Failed to get video metadata."));
            } else {
                resolve(metadata);
            }
        });
    });
}

// Fungsi konversi utama dari video ke WebP
async function convertToWebP(inputPath, outputPath, duration) {
  return new Promise((resolve, reject) => {
    const validDuration = Number.isFinite(duration) && duration > 0 ? Math.min(duration, 8) : 3;
    
    let videoFilters = [
      `scale=384:384:force_original_aspect_ratio=decrease`,
      `pad=384:384:(ow-iw)/2:(oh-ih)/2:color=0x00000000`, 
      `fps=8`
    ];
    
    const filterComplex = videoFilters.join(',');
    
    ffmpeg(inputPath)
      .duration(validDuration)
      .outputOptions([
        '-vcodec', 'libwebp',
        '-vf', filterComplex,
        '-loop', '0',
        '-an',
        '-vsync', '0',
        '-pix_fmt', 'yuva420p',
        '-lossless', '0',
        '-quality', '75',
        '-method', '6'
      ])
      .save(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err));
  });
}

// Fungsi untuk membuat sticker dari WebP static
async function createStaticWebPFallback(inputBuffer, options) {
  try {
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
    throw error;
  }
}

async function createStickerFromVideo(videoBuffer, options = {}) {
  if (!videoBuffer || videoBuffer.length === 0) {
    throw new Error("Video buffer kosong atau tidak valid");
  }

  const detectedFormat = detectFileFormat(videoBuffer);
  
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  const fileExt = detectedFormat === 'webm' ? '.webm' : '.mp4';
  const tempInputPath = path.join(TEMP_DIR, `vid_input_${Date.now()}${fileExt}`);
  const tempOutputPath = path.join(TEMP_DIR, `vid_output_${Date.now()}.webp`);

  try {
    fs.writeFileSync(tempInputPath, videoBuffer);
  
    const videoInfo = await getVideoInfo(tempInputPath);
    const videoStream = videoInfo.streams.find(s => s.codec_type === "video");
    
    if (!videoStream) {
      throw new Error("No video stream found in metadata.");
    }

    const duration = parseFloat(videoStream.duration);

    await convertToWebP(tempInputPath, tempOutputPath, duration);
    
    if (!fs.existsSync(tempOutputPath) || fs.statSync(tempOutputPath).size === 0) {
      throw new Error("Output WebP file was not created or is empty.");
    }

    const webpBuffer = fs.readFileSync(tempOutputPath);

    const sticker = new Sticker(webpBuffer, {
      pack: options.pack || "Bot Stiker",
      author: options.author || "Telegram Import",
      type: StickerTypes.FULL,
      quality: 75,
      background: 'transparent'
    });
    
    return sticker;

  } catch (err) {
    throw err;
  } finally {
    if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
    if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
  }
}

module.exports = { 
  createStickerFromVideo, 
  createStaticWebPFallback, 
  createStickerFromTGS 
};
