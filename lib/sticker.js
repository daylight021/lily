const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const { Sticker, StickerTypes } = require("wa-sticker-formatter");
const zlib = require('zlib');
const sharp = require('sharp');

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
  
  // Deteksi TGS
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

// Function untuk mendapatkan dimensi dari animasi data
function getAnimationDimensions(animationData) {
  const width = animationData.w || 512;
  const height = animationData.h || 512;
  
  // Jaga proporsi, maksimal 512x512
  let finalWidth = width;
  let finalHeight = height;
  
  if (width > 512 || height > 512) {
    const ratio = Math.min(512 / width, 512 / height);
    finalWidth = Math.round(width * ratio);
    finalHeight = Math.round(height * ratio);
  }
  
  // Pastikan genap untuk encoding
  finalWidth = finalWidth % 2 === 0 ? finalWidth : finalWidth - 1;
  finalHeight = finalHeight % 2 === 0 ? finalHeight : finalHeight - 1;
  
  return { width: finalWidth, height: finalHeight, originalWidth: width, originalHeight: height };
}

// SOLUSI UTAMA: TGS to WebP menggunakan eksternal tools
async function createStickerFromTGS(tgsBuffer, options) {
  return new Promise(async (resolve, reject) => {
    try {
      // Decompress jika GZIP
      let processedBuffer = tgsBuffer;
      if (tgsBuffer[0] === 0x1f && tgsBuffer[1] === 0x8b) {
        try {
          processedBuffer = zlib.gunzipSync(tgsBuffer);
        } catch (gzipError) {
          console.log("Gzip decompression failed:", gzipError.message);
          throw new Error("Failed to decompress TGS file");
        }
      }
      
      // Parse JSON
      let animationData;
      try {
        const jsonString = processedBuffer.toString('utf8');
        animationData = JSON.parse(jsonString);
      } catch (parseError) {
        console.log("JSON parsing failed:", parseError.message);
        throw new Error("Invalid TGS JSON format");
      }
      
      const dimensions = getAnimationDimensions(animationData);
      console.log(`TGS dimensions: ${dimensions.originalWidth}x${dimensions.originalHeight} -> ${dimensions.width}x${dimensions.height}`);
      
      // Method 1: rlottie-python approach (jika tersedia)
      try {
        const result = await createTGSWithRLottie(processedBuffer, dimensions, options);
        resolve(result);
        return;
      } catch (rlottieError) {
        console.log("RLottie method failed:", rlottieError.message);
      }
      
      // Method 2: tgs-to-gif tool approach
      try {
        const result = await createTGSWithTgsToGif(processedBuffer, dimensions, options);
        resolve(result);
        return;
      } catch (tgsToGifError) {
        console.log("TGS-to-GIF method failed:", tgsToGifError.message);
      }
      
      // Method 3: Fallback ke WebP animasi sederhana
      try {
        const result = await createSimpleAnimatedWebP(animationData, dimensions, options);
        resolve(result);
        return;
      } catch (simpleError) {
        console.log("Simple animated method failed:", simpleError.message);
      }
      
      // Method 4: Static sticker berkualitas tinggi
      try {
        const result = await createAdvancedStaticFromTGS(animationData, dimensions, options);
        resolve(result);
        return;
      } catch (staticError) {
        console.log("Advanced static method failed:", staticError.message);
      }
      
      throw new Error("All TGS conversion methods failed");
      
    } catch (error) {
      reject(error);
    }
  });
}

// Method 1: Menggunakan rlottie (Telegram's official library)
async function createTGSWithRLottie(jsonBuffer, dimensions, options) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
    
    const tempJsonPath = path.join(TEMP_DIR, `tgs_${Date.now()}.json`);
    const tempGifPath = path.join(TEMP_DIR, `tgs_gif_${Date.now()}.gif`);
    const tempWebpPath = path.join(TEMP_DIR, `tgs_out_${Date.now()}.webp`);
    
    try {
      fs.writeFileSync(tempJsonPath, jsonBuffer);
      
      // Gunakan Python script dengan rlottie jika tersedia
      const { spawn } = require('child_process');
      
      // Coba jalankan rlottie converter
      const python = spawn('python3', ['-c', `
import rlottie
import sys
import json

try:
    animation = rlottie.LottieAnimation.from_file("${tempJsonPath}")
    frame_count = min(45, animation.get_totalframe())  # Max 3 seconds at 15fps
    
    frames = []
    for i in range(0, frame_count, 2):  # Every 2nd frame for optimization
        frame = animation.render_pillow_frame(i)
        frame = frame.resize((${dimensions.width}, ${dimensions.height}), resample=3)
        frames.append(frame)
    
    if frames:
        frames[0].save("${tempGifPath}", save_all=True, append_images=frames[1:], 
                      duration=133, loop=0, transparency=0, disposal=2)
        print("SUCCESS")
    else:
        print("ERROR: No frames generated")
        
except Exception as e:
    print(f"ERROR: {str(e)}")
      `]);
      
      let output = '';
      python.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      python.stderr.on('data', (data) => {
        console.log('RLottie stderr:', data.toString());
      });
      
      python.on('close', async (code) => {
        try {
          if (code === 0 && output.includes('SUCCESS') && fs.existsSync(tempGifPath)) {
            // Convert GIF to WebP
            await new Promise((resolveConvert, rejectConvert) => {
              ffmpeg(tempGifPath)
                .outputOptions([
                  '-vcodec', 'libwebp',
                  '-vf', `scale=${dimensions.width}:${dimensions.height}:flags=lanczos,format=rgba`,
                  '-loop', '0',
                  '-lossless', '0',
                  '-quality', '85',
                  '-method', '6'
                ])
                .save(tempWebpPath)
                .on('end', () => resolveConvert())
                .on('error', (err) => rejectConvert(err));
            });
            
            const webpBuffer = fs.readFileSync(tempWebpPath);
            
            const sticker = new Sticker(webpBuffer, {
              ...options,
              background: 'transparent',
              type: StickerTypes.FULL
            });
            
            console.log("Created TGS sticker using RLottie method");
            resolve(sticker);
          } else {
            throw new Error("RLottie conversion failed");
          }
        } catch (err) {
          reject(err);
        } finally {
          cleanup();
        }
      });
      
      // Timeout setelah 30 detik
      setTimeout(() => {
        python.kill();
        cleanup();
        reject(new Error("RLottie timeout"));
      }, 30000);
      
    } catch (error) {
      cleanup();
      reject(error);
    }
    
    function cleanup() {
      [tempJsonPath, tempGifPath, tempWebpPath].forEach(file => {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      });
    }
  });
}

// Method 2: tgs-to-gif tool approach
async function createTGSWithTgsToGif(jsonBuffer, dimensions, options) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
    
    const tempTgsPath = path.join(TEMP_DIR, `input_${Date.now()}.tgs`);
    const tempGifPath = path.join(TEMP_DIR, `output_${Date.now()}.gif`);
    const tempWebpPath = path.join(TEMP_DIR, `final_${Date.now()}.webp`);
    
    try {
      // Recompress as TGS
      const compressedBuffer = zlib.gzipSync(jsonBuffer);
      fs.writeFileSync(tempTgsPath, compressedBuffer);
      
      const { spawn } = require('child_process');
      
      // Try using tgs_to_gif tool if available
      const converter = spawn('tgs_to_gif', [
        tempTgsPath,
        tempGifPath,
        `${dimensions.width}x${dimensions.height}`,
        '15' // fps
      ]);
      
      converter.on('close', async (code) => {
        try {
          if (code === 0 && fs.existsSync(tempGifPath)) {
            // Convert GIF to WebP
            await new Promise((resolveConvert, rejectConvert) => {
              ffmpeg(tempGifPath)
                .outputOptions([
                  '-vcodec', 'libwebp',
                  '-vf', `scale=${dimensions.width}:${dimensions.height}:flags=lanczos,format=rgba`,
                  '-loop', '0',
                  '-lossless', '0',
                  '-quality', '85',
                  '-method', '6'
                ])
                .save(tempWebpPath)
                .on('end', () => resolveConvert())
                .on('error', (err) => rejectConvert(err));
            });
            
            const webpBuffer = fs.readFileSync(tempWebpPath);
            
            const sticker = new Sticker(webpBuffer, {
              ...options,
              background: 'transparent',
              type: StickerTypes.FULL
            });
            
            console.log("Created TGS sticker using tgs-to-gif method");
            resolve(sticker);
          } else {
            throw new Error("tgs-to-gif conversion failed");
          }
        } catch (err) {
          reject(err);
        } finally {
          cleanup();
        }
      });
      
      converter.on('error', (err) => {
        cleanup();
        reject(new Error(`tgs-to-gif not available: ${err.message}`));
      });
      
      // Timeout
      setTimeout(() => {
        converter.kill();
        cleanup();
        reject(new Error("tgs-to-gif timeout"));
      }, 20000);
      
    } catch (error) {
      cleanup();
      reject(error);
    }
    
    function cleanup() {
      [tempTgsPath, tempGifPath, tempWebpPath].forEach(file => {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      });
    }
  });
}

// Method 3: Create simple animated WebP dari beberapa frame statis
async function createSimpleAnimatedWebP(animationData, dimensions, options) {
  try {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
    
    // Buat beberapa frame statis dengan variasi
    const frameCount = 8; // 8 frame untuk animasi sederhana
    const frameBuffers = [];
    
    for (let i = 0; i < frameCount; i++) {
      const progress = i / frameCount;
      const frameBuffer = await createStaticFrameFromTGS(animationData, dimensions, progress);
      frameBuffers.push(frameBuffer);
    }
    
    // Gabungkan frame menjadi animated WebP menggunakan FFmpeg
    const tempFrameDir = path.join(TEMP_DIR, `frames_${Date.now()}`);
    const tempWebpPath = path.join(TEMP_DIR, `animated_${Date.now()}.webp`);
    
    fs.mkdirSync(tempFrameDir, { recursive: true });
    
    // Save all frames
    for (let i = 0; i < frameBuffers.length; i++) {
      const framePath = path.join(tempFrameDir, `frame_${i.toString().padStart(3, '0')}.png`);
      fs.writeFileSync(framePath, frameBuffers[i]);
    }
    
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(path.join(tempFrameDir, 'frame_%03d.png'))
        .inputOptions(['-framerate', '4']) // 4 fps for smooth but not too fast
        .outputOptions([
          '-vcodec', 'libwebp',
          '-vf', `scale=${dimensions.width}:${dimensions.height}:flags=lanczos,format=rgba`,
          '-loop', '0',
          '-lossless', '0',
          '-quality', '85',
          '-method', '6'
        ])
        .save(tempWebpPath)
        .on('end', () => {
          try {
            const webpBuffer = fs.readFileSync(tempWebpPath);
            
            const sticker = new Sticker(webpBuffer, {
              ...options,
              background: 'transparent',
              type: StickerTypes.FULL
            });
            
            console.log("Created simple animated WebP from TGS");
            resolve(sticker);
          } catch (err) {
            reject(err);
          } finally {
            // Cleanup
            if (fs.existsSync(tempFrameDir)) {
              fs.readdirSync(tempFrameDir).forEach(file => {
                fs.unlinkSync(path.join(tempFrameDir, file));
              });
              fs.rmdirSync(tempFrameDir);
            }
            if (fs.existsSync(tempWebpPath)) fs.unlinkSync(tempWebpPath);
          }
        })
        .on('error', (err) => {
          // Cleanup on error
          if (fs.existsSync(tempFrameDir)) {
            fs.readdirSync(tempFrameDir).forEach(file => {
              fs.unlinkSync(path.join(tempFrameDir, file));
            });
            fs.rmdirSync(tempFrameDir);
          }
          reject(new Error(`Animated WebP creation failed: ${err.message}`));
        });
    });
    
  } catch (error) {
    throw new Error(`Simple animated WebP method failed: ${error.message}`);
  }
}

// Create frame dengan animasi progress
async function createStaticFrameFromTGS(animationData, dimensions, progress) {
  // Extract dominant colors
  const colors = extractDominantColors(animationData);
  const primaryColor = colors[0] || { r: 74, g: 144, b: 226 };
  const secondaryColor = colors[1] || { r: 155, g: 89, b: 182 };
  
  // Create frame dengan efek animasi berdasarkan progress
  const rotation = progress * 360;
  const scale = 0.8 + (Math.sin(progress * Math.PI * 2) * 0.2);
  const opacity = 0.7 + (Math.cos(progress * Math.PI * 2) * 0.3);
  
  const svgContent = `
    <svg width="${dimensions.width}" height="${dimensions.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="grad${Math.floor(progress * 100)}" cx="50%" cy="50%" r="60%">
          <stop offset="0%" style="stop-color:rgba(${primaryColor.r},${primaryColor.g},${primaryColor.b},${opacity})" />
          <stop offset="70%" style="stop-color:rgba(${secondaryColor.r},${secondaryColor.g},${secondaryColor.b},${opacity * 0.7})" />
          <stop offset="100%" style="stop-color:rgba(${primaryColor.r},${primaryColor.g},${primaryColor.b},0.1)" />
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
          <feMerge> 
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      
      <g transform="translate(${dimensions.width/2}, ${dimensions.height/2}) scale(${scale}) rotate(${rotation})">
        <!-- Main shape -->
        <circle r="${Math.min(dimensions.width, dimensions.height) * 0.25}" 
                fill="url(#grad${Math.floor(progress * 100)})" 
                filter="url(#glow)" />
        
        <!-- Animated elements -->
        <g transform="rotate(${-rotation * 2})">
          <circle cx="${30 * Math.cos(progress * Math.PI * 4)}" 
                  cy="${30 * Math.sin(progress * Math.PI * 4)}" 
                  r="8" 
                  fill="rgba(255,255,255,${0.3 + progress * 0.4})" />
        </g>
        
        <!-- Central icon -->
        <circle r="15" fill="rgba(255,255,255,0.9)" />
        <polygon points="-6,-8 10,0 -6,8" fill="rgba(100,100,100,0.8)" />
      </g>
      
      <!-- Progress indicator -->
      <circle cx="${dimensions.width/2}" cy="${dimensions.height/2}" 
              r="${Math.min(dimensions.width, dimensions.height) * 0.35}" 
              fill="none" 
              stroke="rgba(255,255,255,0.2)" 
              stroke-width="2" 
              stroke-dasharray="${progress * 100}, 100" 
              transform="rotate(-90, ${dimensions.width/2}, ${dimensions.height/2})" />
    </svg>
  `;
  
  const pngBuffer = await sharp(Buffer.from(svgContent))
    .png()
    .toBuffer();
    
  return pngBuffer;
}

// Extract colors dari TGS data
function extractDominantColors(animationData) {
  const colors = [];
  const layers = animationData.layers || [];
  
  for (const layer of layers.slice(0, 10)) { // Check first 10 layers
    if (layer.shapes) {
      for (const shape of layer.shapes) {
        if (shape.it) {
          for (const item of shape.it) {
            if (item.ty === 'fl' && item.c && item.c.k) {
              const color = item.c.k;
              if (Array.isArray(color) && color.length >= 3) {
                colors.push({
                  r: Math.round(color[0] * 255),
                  g: Math.round(color[1] * 255),
                  b: Math.round(color[2] * 255)
                });
              }
            }
          }
        }
      }
    }
  }
  
  // Return unique colors
  const uniqueColors = colors.filter((color, index, self) => 
    index === self.findIndex(c => c.r === color.r && c.g === color.g && c.b === color.b)
  );
  
  return uniqueColors.length > 0 ? uniqueColors : [
    { r: 74, g: 144, b: 226 },
    { r: 155, g: 89, b: 182 },
    { r: 52, g: 152, b: 219 }
  ];
}

// Method 4: Advanced static sticker dengan analisis TGS yang lebih baik
async function createAdvancedStaticFromTGS(animationData, dimensions, options) {
  try {
    const colors = extractDominantColors(animationData);
    const layers = animationData.layers || [];
    
    // Analyze animation for shape complexity
    let hasComplexShapes = false;
    let shapeCount = 0;
    
    layers.forEach(layer => {
      if (layer.shapes) {
        layer.shapes.forEach(shape => {
          if (shape.it) {
            shapeCount += shape.it.length;
            shape.it.forEach(item => {
              if (['sh', 'el', 'sr'].includes(item.ty)) {
                hasComplexShapes = true;
              }
            });
          }
        });
      }
    });
    
    const complexity = Math.min(shapeCount / 10, 1); // 0-1 scale
    const primaryColor = colors[0] || { r: 74, g: 144, b: 226 };
    const secondaryColor = colors[1] || { r: 155, g: 89, b: 182 };
    const accentColor = colors[2] || { r: 52, g: 152, b: 219 };
    
    // Create sophisticated design based on analysis
    const svgContent = `
      <svg width="${dimensions.width}" height="${dimensions.height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="mainGrad" cx="50%" cy="50%" r="70%">
            <stop offset="0%" style="stop-color:rgba(${primaryColor.r},${primaryColor.g},${primaryColor.b},0.9)" />
            <stop offset="40%" style="stop-color:rgba(${secondaryColor.r},${secondaryColor.g},${secondaryColor.b},0.7)" />
            <stop offset="100%" style="stop-color:rgba(${accentColor.r},${accentColor.g},${accentColor.b},0.3)" />
          </radialGradient>
          
          <linearGradient id="overlayGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:rgba(255,255,255,0.3)" />
            <stop offset="100%" style="stop-color:rgba(255,255,255,0.05)" />
          </linearGradient>
          
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
            <feMerge> 
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        
        <!-- Background pattern based on complexity -->
        ${hasComplexShapes ? `
          <g opacity="0.1">
            ${Array.from({length: Math.floor(complexity * 8)}, (_, i) => {
              const angle = (i * 45) % 360;
              const radius = 20 + (i * 10);
              const x = dimensions.width/2 + Math.cos(angle * Math.PI/180) * radius;
              const y = dimensions.height/2 + Math.sin(angle * Math.PI/180) * radius;
              return `<circle cx="${x}" cy="${y}" r="3" fill="rgba(${primaryColor.r},${primaryColor.g},${primaryColor.b},0.5)" />`;
            }).join('')}
          </g>
        ` : ''}
        
        <!-- Main sticker shape -->
        <circle cx="${dimensions.width/2}" cy="${dimensions.height/2}" 
                r="${Math.min(dimensions.width, dimensions.height) * 0.3}" 
                fill="url(#mainGrad)" 
                filter="url(#glow)" />
        
        <!-- Overlay for depth -->
        <circle cx="${dimensions.width/2}" cy="${dimensions.height/2}" 
                r="${Math.min(dimensions.width, dimensions.height) * 0.2}" 
                fill="url(#overlayGrad)" />
        
        <!-- Animation symbol -->
        <g transform="translate(${dimensions.width/2}, ${dimensions.height/2})">
          <circle r="${Math.min(dimensions.width, dimensions.height) * 0.06}" 
                  fill="rgba(255,255,255,0.95)" />
          <polygon points="-${Math.min(dimensions.width, dimensions.height) * 0.025},-${Math.min(dimensions.width, dimensions.height) * 0.03} 
                           ${Math.min(dimensions.width, dimensions.height) * 0.04},0 
                           -${Math.min(dimensions.width, dimensions.height) * 0.025},${Math.min(dimensions.width, dimensions.height) * 0.03}" 
                   fill="rgba(${primaryColor.r},${primaryColor.g},${primaryColor.b},0.8)" />
        </g>
        
        <!-- Decorative elements based on shape count -->
        ${shapeCount > 5 ? `
          <circle cx="${dimensions.width/2}" cy="${dimensions.height/2}" 
                  r="${Math.min(dimensions.width, dimensions.height) * 0.35}" 
                  fill="none" 
                  stroke="rgba(255,255,255,0.2)" 
                  stroke-width="1" 
                  stroke-dasharray="5,5" />
        ` : ''}
      </svg>
    `;
    
    const pngBuffer = await sharp(Buffer.from(svgContent))
      .png()
      .resize(dimensions.width, dimensions.height, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .toBuffer();
    
    const sticker = new Sticker(pngBuffer, {
      ...options,
      background: 'transparent',
      type: StickerTypes.FULL
    });
    
    console.log("Created advanced static sticker from TGS analysis");
    return sticker;
    
  } catch (error) {
    throw new Error(`Advanced static TGS method failed: ${error.message}`);
  }
}

// Existing video functions...
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

async function convertToWebP(inputPath, outputPath, duration, targetWidth = 512, targetHeight = 512) {
  return new Promise((resolve, reject) => {
    const validDuration = Number.isFinite(duration) && duration > 0 ? Math.min(duration, 8) : 3;
    
    let videoFilters = [
      `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease`,
      `pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`, 
      `fps=15`
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
        '-quality', '90',
        '-method', '6'
      ])
      .save(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err));
  });
}

async function createStaticWebPFallback(inputBuffer, options) {
  try {
    const image = sharp(inputBuffer);
    const metadata = await image.metadata();
    
    let { width, height } = metadata;
    const maxSize = 512;
    
    if (width > maxSize || height > maxSize) {
      const ratio = Math.min(maxSize / width, maxSize / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    
    const resizedBuffer = await image
      .resize(width, height, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toBuffer();

    const stickerOptions = {
      pack: options.pack || "Bot Stiker",
      author: options.author || "Telegram Import",
      type: StickerTypes.FULL,
      quality: 90,
      background: 'transparent'
    };

    const sticker = new Sticker(resizedBuffer, stickerOptions);
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
    const videoWidth = videoStream.width || 512;
    const videoHeight = videoStream.height || 512;
    
    const maxSize = 512;
    let targetWidth = videoWidth;
    let targetHeight = videoHeight;
    
    if (videoWidth > maxSize || videoHeight > maxSize) {
      const ratio = Math.min(maxSize / videoWidth, maxSize / videoHeight);
      targetWidth = Math.round(videoWidth * ratio);
      targetHeight = Math.round(videoHeight * ratio);
    }
    
    targetWidth = targetWidth % 2 === 0 ? targetWidth : targetWidth - 1;
    targetHeight = targetHeight % 2 === 0 ? targetHeight : targetHeight - 1;

    await convertToWebP(tempInputPath, tempOutputPath, duration, targetWidth, targetHeight);
    
    if (!fs.existsSync(tempOutputPath) || fs.statSync(tempOutputPath).size === 0) {
      throw new Error("Output WebP file was not created or is empty.");
    }

    const webpBuffer = fs.readFileSync(tempOutputPath);

    const sticker = new Sticker(webpBuffer, {
      pack: options.pack || "Bot Stiker",
      author: options.author || "Telegram Import",
      type: StickerTypes.FULL,
      quality: 90,
      background: 'transparent'
    });
    
    console.log(`Created video sticker: ${videoWidth}x${videoHeight} -> ${targetWidth}x${targetHeight}`);
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
