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

// Solusi sederhana: Konversi TGS ke PNG frames menggunakan sharp + canvas
async function createStickerFromTGS(tgsBuffer, options) {
  return new Promise(async (resolve, reject) => {
    try {
      // Decompress jika GZIP
      let processedBuffer = tgsBuffer;
      if (tgsBuffer[0] === 0x1f && tgsBuffer[1] === 0x8b) {
        processedBuffer = zlib.gunzipSync(tgsBuffer);
      }
      
      // Parse JSON
      let animationData;
      try {
        animationData = JSON.parse(processedBuffer.toString('utf8'));
      } catch (parseError) {
        throw new Error("Invalid TGS JSON format");
      }
      
      const dimensions = getAnimationDimensions(animationData);
      console.log(`TGS dimensions: ${dimensions.originalWidth}x${dimensions.originalHeight} -> ${dimensions.width}x${dimensions.height}`);
      
      // Method 1: Coba dengan node-canvas (paling reliable)
      try {
        const result = await createTGSWithCanvas(processedBuffer, animationData, dimensions, options);
        resolve(result);
        return;
      } catch (canvasError) {
        console.log("Canvas method failed:", canvasError.message);
      }
      
      // Method 2: Coba dengan FFmpeg langsung (jika ada dukungan lottie)
      try {
        const result = await createTGSWithFFmpeg(processedBuffer, dimensions, options);
        resolve(result);
        return;
      } catch (ffmpegError) {
        console.log("FFmpeg method failed:", ffmpegError.message);
      }
      
      // Method 3: Buat static sticker dari frame pertama
      try {
        const result = await createStaticFromTGS(animationData, dimensions, options);
        resolve(result);
        return;
      } catch (staticError) {
        console.log("Static method failed:", staticError.message);
      }
      
      throw new Error("All TGS conversion methods failed");
      
    } catch (error) {
      reject(error);
    }
  });
}

// Method 1: Canvas-based conversion - Extract actual shapes from TGS
async function createTGSWithCanvas(jsonBuffer, animationData, dimensions, options) {
  try {
    const { createCanvas, loadImage } = require('canvas');
    
    const canvas = createCanvas(dimensions.width, dimensions.height);
    const ctx = canvas.getContext('2d');
    
    // Clear background (transparent)
    ctx.clearRect(0, 0, dimensions.width, dimensions.height);
    
    // Try to extract and render basic shapes from TGS data
    try {
      await renderTGSLayers(ctx, animationData, dimensions);
      console.log("Successfully rendered TGS layers to canvas");
    } catch (renderError) {
      console.log("Failed to render TGS layers, using enhanced placeholder");
      // Fallback to enhanced placeholder
      await createEnhancedPlaceholder(ctx, dimensions);
    }
    
    const pngBuffer = canvas.toBuffer('image/png');
    
    const sticker = new Sticker(pngBuffer, {
      ...options,
      background: 'transparent',
      type: StickerTypes.FULL
    });
    
    console.log("Created TGS sticker using Canvas method");
    return sticker;
    
  } catch (error) {
    throw new Error(`Canvas method failed: ${error.message}`);
  }
}

// Function to render TGS layers to canvas
async function renderTGSLayers(ctx, animationData, dimensions) {
  const layers = animationData.layers || [];
  const width = dimensions.width;
  const height = dimensions.height;
  
  // Scale factor from original to target size
  const scaleX = width / (animationData.w || width);
  const scaleY = height / (animationData.h || height);
  
  ctx.save();
  ctx.scale(scaleX, scaleY);
  
  // Process each layer
  for (const layer of layers) {
    if (!layer.shapes) continue;
    
    ctx.save();
    
    // Apply layer transform if exists
    if (layer.ks && layer.ks.p) {
      const pos = layer.ks.p.k || layer.ks.p;
      if (Array.isArray(pos) && pos.length >= 2) {
        ctx.translate(pos[0], pos[1]);
      }
    }
    
    // Process shapes in layer
    for (const shape of layer.shapes) {
      await renderShape(ctx, shape, layer);
    }
    
    ctx.restore();
  }
  
  ctx.restore();
}

// Function to render individual shapes
async function renderShape(ctx, shape, layer) {
  if (!shape.it) return; // No shape items
  
  let fillColor = null;
  let strokeColor = null;
  let path = null;
  
  // Extract fill, stroke, and path from shape items
  for (const item of shape.it) {
    switch (item.ty) {
      case 'fl': // Fill
        if (item.c && item.c.k) {
          const color = item.c.k;
          if (Array.isArray(color) && color.length >= 3) {
            const opacity = (item.o && item.o.k) ? (item.o.k / 100) : 1;
            fillColor = `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${opacity})`;
          }
        }
        break;
        
      case 'st': // Stroke
        if (item.c && item.c.k) {
          const color = item.c.k;
          if (Array.isArray(color) && color.length >= 3) {
            const opacity = (item.o && item.o.k) ? (item.o.k / 100) : 1;
            strokeColor = `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${opacity})`;
          }
        }
        break;
        
      case 'sh': // Shape path
        if (item.ks && item.ks.k && item.ks.k.v) {
          path = item.ks.k;
        }
        break;
        
      case 'el': // Ellipse
        if (item.s && item.s.k && item.p && item.p.k) {
          const size = item.s.k;
          const pos = item.p.k;
          
          ctx.beginPath();
          ctx.ellipse(pos[0], pos[1], size[0]/2, size[1]/2, 0, 0, 2 * Math.PI);
          
          if (fillColor) {
            ctx.fillStyle = fillColor;
            ctx.fill();
          }
          if (strokeColor) {
            ctx.strokeStyle = strokeColor;
            ctx.stroke();
          }
        }
        break;
        
      case 'rc': // Rectangle
        if (item.s && item.s.k && item.p && item.p.k) {
          const size = item.s.k;
          const pos = item.p.k;
          
          ctx.beginPath();
          ctx.rect(pos[0] - size[0]/2, pos[1] - size[1]/2, size[0], size[1]);
          
          if (fillColor) {
            ctx.fillStyle = fillColor;
            ctx.fill();
          }
          if (strokeColor) {
            ctx.strokeStyle = strokeColor;
            ctx.stroke();
          }
        }
        break;
    }
  }
  
  // Draw path if available
  if (path && path.v && Array.isArray(path.v)) {
    ctx.beginPath();
    
    const vertices = path.v;
    if (vertices.length > 0) {
      ctx.moveTo(vertices[0][0], vertices[0][1]);
      
      for (let i = 1; i < vertices.length; i++) {
        ctx.lineTo(vertices[i][0], vertices[i][1]);
      }
      
      if (path.c) { // Closed path
        ctx.closePath();
      }
      
      if (fillColor) {
        ctx.fillStyle = fillColor;
        ctx.fill();
      }
      if (strokeColor) {
        ctx.strokeStyle = strokeColor;
        ctx.stroke();
      }
    }
  }
}

// Enhanced placeholder when TGS parsing fails
async function createEnhancedPlaceholder(ctx, dimensions) {
  const width = dimensions.width;
  const height = dimensions.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const size = Math.min(width, height);
  
  // Create a more appealing design instead of just blue circle
  
  // Background subtle pattern
  ctx.fillStyle = 'rgba(200, 200, 200, 0.1)';
  ctx.fillRect(0, 0, width, height);
  
  // Main shape - rounded rectangle instead of circle
  const rectSize = size * 0.7;
  const cornerRadius = rectSize * 0.1;
  
  ctx.beginPath();
  ctx.roundRect(centerX - rectSize/2, centerY - rectSize/2, rectSize, rectSize, cornerRadius);
  
  // Gradient fill
  const gradient = ctx.createLinearGradient(centerX - rectSize/2, centerY - rectSize/2, centerX + rectSize/2, centerY + rectSize/2);
  gradient.addColorStop(0, 'rgba(100, 100, 100, 0.3)');
  gradient.addColorStop(1, 'rgba(150, 150, 150, 0.1)');
  
  ctx.fillStyle = gradient;
  ctx.fill();
  
  // Border
  ctx.strokeStyle = 'rgba(120, 120, 120, 0.4)';
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // Animation icon (better than just play button)
  const iconSize = size * 0.15;
  ctx.fillStyle = 'rgba(80, 80, 80, 0.8)';
  ctx.font = `${iconSize}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🎭', centerX, centerY - iconSize * 0.3);
  
  // Text
  ctx.fillStyle = 'rgba(100, 100, 100, 0.6)';
  ctx.font = `${Math.max(10, size * 0.08)}px Arial`;
  ctx.fillText('Animated', centerX, centerY + iconSize * 0.8);
}

// Method 2: FFmpeg-based conversion
async function createTGSWithFFmpeg(jsonBuffer, dimensions, options) {
  return new Promise((resolve, reject) => {
    const tempJsonPath = path.join(TEMP_DIR, `tgs_${Date.now()}.json`);
    const tempWebpPath = path.join(TEMP_DIR, `tgs_out_${Date.now()}.webp`);
    
    try {
      fs.writeFileSync(tempJsonPath, jsonBuffer);
      
      // Coba beberapa input format untuk lottie
      const inputFormats = [
        { format: 'lottie', input: tempJsonPath },
        { format: 'lavfi', input: `lottie=filename=${tempJsonPath}:size=${dimensions.width}x${dimensions.height}` }
      ];
      
      let formatIndex = 0;
      
      function tryNextFormat() {
        if (formatIndex >= inputFormats.length) {
          cleanup();
          reject(new Error("FFmpeg lottie support not available"));
          return;
        }
        
        const currentFormat = inputFormats[formatIndex];
        formatIndex++;
        
        const ffmpegCmd = ffmpeg()
          .input(currentFormat.input)
          .inputOptions(['-f', currentFormat.format]);
        
        if (currentFormat.format === 'lottie') {
          ffmpegCmd.inputOptions(['-t', '3']); // 3 seconds
        }
        
        ffmpegCmd
          .outputOptions([
            '-vcodec', 'libwebp',
            '-vf', `scale=${dimensions.width}:${dimensions.height}:flags=lanczos,fps=15,format=rgba`,
            '-loop', '0',
            '-lossless', '0',
            '-quality', '90',
            '-method', '6'
          ])
          .output(tempWebpPath)
          .on('end', () => {
            try {
              cleanup();
              const webpBuffer = fs.readFileSync(tempWebpPath);
              if (fs.existsSync(tempWebpPath)) fs.unlinkSync(tempWebpPath);
              
              const sticker = new Sticker(webpBuffer, {
                ...options,
                background: 'transparent'
              });
              
              console.log("Created TGS sticker using FFmpeg method");
              resolve(sticker);
            } catch (err) {
              reject(err);
            }
          })
          .on('error', (err) => {
            console.log(`FFmpeg format ${currentFormat.format} failed:`, err.message);
            tryNextFormat();
          })
          .run();
      }
      
      tryNextFormat();
      
    } catch (error) {
      cleanup();
      reject(error);
    }
    
    function cleanup() {
      if (fs.existsSync(tempJsonPath)) fs.unlinkSync(tempJsonPath);
    }
  });
}

// Method 3: Static sticker from first frame
async function createStaticFromTGS(animationData, dimensions, options) {
  try {
    // Ambil informasi warna atau bentuk dari layer pertama
    const layers = animationData.layers || [];
    
    // Buat static image menggunakan sharp
    const svgContent = `
      <svg width="${dimensions.width}" height="${dimensions.height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="grad1" cx="50%" cy="50%" r="50%">
            <stop offset="0%" style="stop-color:#4A90E2;stop-opacity:0.8" />
            <stop offset="100%" style="stop-color:#4A90E2;stop-opacity:0.2" />
          </radialGradient>
        </defs>
        <circle cx="${dimensions.width/2}" cy="${dimensions.height/2}" r="${Math.min(dimensions.width, dimensions.height)/6}" fill="url(#grad1)" />
        <text x="${dimensions.width/2}" y="${dimensions.height/2+5}" text-anchor="middle" font-family="Arial" font-size="${Math.max(16, Math.min(dimensions.width, dimensions.height)/16)}" fill="rgba(255,255,255,0.9)">▶</text>
      </svg>
    `;
    
    const pngBuffer = await sharp(Buffer.from(svgContent))
      .png()
      .toBuffer();
    
    const sticker = new Sticker(pngBuffer, {
      ...options,
      background: 'transparent',
      type: StickerTypes.FULL
    });
    
    console.log("Created static sticker from TGS data");
    return sticker;
    
  } catch (error) {
    throw new Error(`Static TGS method failed: ${error.message}`);
  }
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

// Fungsi konversi dari video ke WebP dengan preserve aspect ratio
async function convertToWebP(inputPath, outputPath, duration, targetWidth = 512, targetHeight = 512) {
  return new Promise((resolve, reject) => {
    const validDuration = Number.isFinite(duration) && duration > 0 ? Math.min(duration, 8) : 3;
    
    // Preserve aspect ratio
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

// Fungsi untuk membuat sticker dari WebP static dengan preserve ratio
async function createStaticWebPFallback(inputBuffer, options) {
  try {
    // Gunakan sharp untuk resize dengan preserve aspect ratio
    const image = sharp(inputBuffer);
    const metadata = await image.metadata();
    
    let { width, height } = metadata;
    const maxSize = 512;
    
    // Calculate new dimensions maintaining aspect ratio
    if (width > maxSize || height > maxSize) {
      const ratio = Math.min(maxSize / width, maxSize / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    
    const resizedBuffer = await image
      .resize(width, height, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 } // Transparent background
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
    
    // Calculate target dimensions maintaining aspect ratio
    const maxSize = 512;
    let targetWidth = videoWidth;
    let targetHeight = videoHeight;
    
    if (videoWidth > maxSize || videoHeight > maxSize) {
      const ratio = Math.min(maxSize / videoWidth, maxSize / videoHeight);
      targetWidth = Math.round(videoWidth * ratio);
      targetHeight = Math.round(videoHeight * ratio);
    }
    
    // Ensure even numbers for encoding
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
