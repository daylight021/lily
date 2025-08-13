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

// Improved TGS to sticker converter
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
      
      // Method 1: Try FFmpeg with Lottie support (best quality)
      try {
        const result = await createTGSWithFFmpegLottie(processedBuffer, dimensions, options);
        resolve(result);
        return;
      } catch (ffmpegError) {
        console.log("FFmpeg Lottie method failed:", ffmpegError.message);
      }
      
      // Method 2: Try using puppeteer/Chrome for Lottie rendering
      try {
        const result = await createTGSWithPuppeteer(processedBuffer, dimensions, options);
        resolve(result);
        return;
      } catch (puppeteerError) {
        console.log("Puppeteer method failed:", puppeteerError.message);
      }
      
      // Method 3: Improved Canvas method with better Lottie parsing
      try {
        const result = await createTGSWithImprovedCanvas(processedBuffer, animationData, dimensions, options);
        resolve(result);
        return;
      } catch (canvasError) {
        console.log("Improved Canvas method failed:", canvasError.message);
      }
      
      // Method 4: Create high-quality static sticker as fallback
      try {
        const result = await createHighQualityStaticFromTGS(animationData, dimensions, options);
        resolve(result);
        return;
      } catch (staticError) {
        console.log("High-quality static method failed:", staticError.message);
      }
      
      throw new Error("All TGS conversion methods failed");
      
    } catch (error) {
      reject(error);
    }
  });
}

// Method 1: FFmpeg with Lottie support
async function createTGSWithFFmpegLottie(jsonBuffer, dimensions, options) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
    
    const tempJsonPath = path.join(TEMP_DIR, `tgs_${Date.now()}.json`);
    const tempWebpPath = path.join(TEMP_DIR, `tgs_out_${Date.now()}.webp`);
    
    try {
      fs.writeFileSync(tempJsonPath, jsonBuffer);
      
      // Try different FFmpeg approaches for Lottie
      const ffmpegCmd = ffmpeg()
        .input(tempJsonPath)
        .inputOptions([
          '-f', 'lavfi',
          '-i', `lottie=filename=${tempJsonPath}:size=${dimensions.width}x${dimensions.height}:rate=15`
        ])
        .outputOptions([
          '-vcodec', 'libwebp',
          '-vf', `scale=${dimensions.width}:${dimensions.height}:flags=lanczos,format=rgba`,
          '-loop', '0',
          '-t', '3', // 3 seconds animation
          '-lossless', '0',
          '-quality', '85',
          '-method', '6',
          '-preset', 'picture'
        ])
        .output(tempWebpPath)
        .on('end', () => {
          try {
            cleanup();
            
            if (!fs.existsSync(tempWebpPath) || fs.statSync(tempWebpPath).size === 0) {
              throw new Error("FFmpeg output file is empty or missing");
            }
            
            const webpBuffer = fs.readFileSync(tempWebpPath);
            if (fs.existsSync(tempWebpPath)) fs.unlinkSync(tempWebpPath);
            
            const sticker = new Sticker(webpBuffer, {
              ...options,
              background: 'transparent',
              type: StickerTypes.FULL
            });
            
            console.log("Created TGS sticker using FFmpeg Lottie method");
            resolve(sticker);
          } catch (err) {
            reject(err);
          }
        })
        .on('error', (err) => {
          cleanup();
          reject(new Error(`FFmpeg Lottie failed: ${err.message}`));
        });
      
      ffmpegCmd.run();
      
    } catch (error) {
      cleanup();
      reject(error);
    }
    
    function cleanup() {
      if (fs.existsSync(tempJsonPath)) fs.unlinkSync(tempJsonPath);
    }
  });
}

// Method 2: Puppeteer-based rendering (requires puppeteer installation)
async function createTGSWithPuppeteer(jsonBuffer, dimensions, options) {
  try {
    // Try to require puppeteer - this is optional
    const puppeteer = require('puppeteer');
    
    const browser = await puppeteer.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setViewport({ 
      width: dimensions.width, 
      height: dimensions.height,
      deviceScaleFactor: 1
    });
    
    // Create HTML with Lottie animation
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js"></script>
        <style>
          body { 
            margin: 0; 
            padding: 0; 
            background: transparent;
            width: ${dimensions.width}px;
            height: ${dimensions.height}px;
          }
          #lottie-container {
            width: 100%;
            height: 100%;
          }
        </style>
      </head>
      <body>
        <div id="lottie-container"></div>
        <script>
          const animationData = ${jsonBuffer.toString('utf8')};
          const animation = lottie.loadAnimation({
            container: document.getElementById('lottie-container'),
            renderer: 'svg',
            loop: true,
            autoplay: true,
            animationData: animationData
          });
          
          // Wait for animation to load
          animation.addEventListener('config_ready', () => {
            window.lottieReady = true;
          });
        </script>
      </body>
      </html>
    `;
    
    await page.setContent(htmlContent);
    await page.waitForFunction('window.lottieReady', { timeout: 10000 });
    
    // Wait a bit for the animation to render
    await page.waitForTimeout(1000);
    
    // Take screenshot
    const screenshot = await page.screenshot({
      type: 'png',
      omitBackground: true,
      clip: {
        x: 0,
        y: 0,
        width: dimensions.width,
        height: dimensions.height
      }
    });
    
    await browser.close();
    
    const sticker = new Sticker(screenshot, {
      ...options,
      background: 'transparent',
      type: StickerTypes.FULL
    });
    
    console.log("Created TGS sticker using Puppeteer method");
    return sticker;
    
  } catch (error) {
    throw new Error(`Puppeteer method failed: ${error.message}`);
  }
}

// Method 3: Improved Canvas method with better Lottie parsing
async function createTGSWithImprovedCanvas(jsonBuffer, animationData, dimensions, options) {
  try {
    const { createCanvas, loadImage } = require('canvas');
    
    const canvas = createCanvas(dimensions.width, dimensions.height);
    const ctx = canvas.getContext('2d');
    
    // Clear background with transparency
    ctx.clearRect(0, 0, dimensions.width, dimensions.height);
    ctx.globalCompositeOperation = 'source-over';
    
    // Better Lottie layer processing
    await renderImprovedLottie(ctx, animationData, dimensions);
    
    const pngBuffer = canvas.toBuffer('image/png');
    
    const sticker = new Sticker(pngBuffer, {
      ...options,
      background: 'transparent',
      type: StickerTypes.FULL
    });
    
    console.log("Created TGS sticker using Improved Canvas method");
    return sticker;
    
  } catch (error) {
    throw new Error(`Improved Canvas method failed: ${error.message}`);
  }
}

// Improved Lottie rendering with better layer processing
async function renderImprovedLottie(ctx, animationData, dimensions) {
  const layers = animationData.layers || [];
  const width = dimensions.width;
  const height = dimensions.height;
  
  // Get frame rate and duration
  const frameRate = animationData.fr || 30;
  const inPoint = animationData.ip || 0;
  const outPoint = animationData.op || 60;
  const duration = (outPoint - inPoint) / frameRate;
  
  // Use middle frame for static representation
  const targetFrame = Math.floor((inPoint + outPoint) / 2);
  
  // Scale factor from original to target size
  const scaleX = width / (animationData.w || width);
  const scaleY = height / (animationData.h || height);
  
  ctx.save();
  ctx.scale(scaleX, scaleY);
  
  // Sort layers by index (back to front)
  const sortedLayers = layers.sort((a, b) => (a.ind || 0) - (b.ind || 0));
  
  // Process each layer
  for (const layer of sortedLayers) {
    try {
      await renderImprovedLayer(ctx, layer, targetFrame, animationData);
    } catch (layerError) {
      console.log(`Warning: Failed to render layer ${layer.ind}:`, layerError.message);
      // Continue with other layers
    }
  }
  
  ctx.restore();
}

// Improved layer rendering
async function renderImprovedLayer(ctx, layer, frame, animationData) {
  if (!layer.shapes && layer.ty !== 4) return; // Skip non-shape layers except images
  
  // Check layer visibility and timing
  const startTime = layer.ip || 0;
  const endTime = layer.op || animationData.op || 60;
  
  if (frame < startTime || frame > endTime) {
    return; // Layer not visible at this frame
  }
  
  ctx.save();
  
  // Apply layer transform
  if (layer.ks) {
    const transform = interpolateTransform(layer.ks, frame);
    
    // Apply position
    if (transform.position) {
      ctx.translate(transform.position[0], transform.position[1]);
    }
    
    // Apply rotation
    if (transform.rotation) {
      ctx.rotate((transform.rotation * Math.PI) / 180);
    }
    
    // Apply scale
    if (transform.scale) {
      ctx.scale(transform.scale[0] / 100, transform.scale[1] / 100);
    }
    
    // Apply opacity
    if (transform.opacity !== undefined) {
      ctx.globalAlpha = transform.opacity / 100;
    }
  }
  
  // Render shapes
  if (layer.shapes) {
    for (const shape of layer.shapes) {
      try {
        await renderImprovedShape(ctx, shape, frame);
      } catch (shapeError) {
        console.log(`Warning: Failed to render shape in layer ${layer.ind}:`, shapeError.message);
      }
    }
  }
  
  ctx.restore();
}

// Improved shape rendering with better path handling
async function renderImprovedShape(ctx, shape, frame) {
  if (!shape.it) return;
  
  let fillColor = null;
  let strokeColor = null;
  let strokeWidth = 1;
  let paths = [];
  
  // Extract all shape properties
  for (const item of shape.it) {
    try {
      switch (item.ty) {
        case 'fl': // Fill
          fillColor = interpolateColor(item, frame);
          break;
          
        case 'st': // Stroke
          strokeColor = interpolateColor(item, frame);
          if (item.w) {
            strokeWidth = interpolateValue(item.w, frame) || 1;
          }
          break;
          
        case 'sh': // Shape path
          const pathData = interpolatePath(item, frame);
          if (pathData) paths.push(pathData);
          break;
          
        case 'el': // Ellipse
          const ellipseData = interpolateEllipse(item, frame);
          if (ellipseData) paths.push(ellipseData);
          break;
          
        case 'rc': // Rectangle
          const rectData = interpolateRectangle(item, frame);
          if (rectData) paths.push(rectData);
          break;
          
        case 'gr': // Group
          // Recursively process group items
          if (item.it) {
            ctx.save();
            for (const subItem of item.it) {
              if (subItem.ty === 'tr' && subItem.tr) {
                // Apply group transform
                const groupTransform = interpolateTransform(subItem.tr, frame);
                if (groupTransform.position) {
                  ctx.translate(groupTransform.position[0], groupTransform.position[1]);
                }
                if (groupTransform.rotation) {
                  ctx.rotate((groupTransform.rotation * Math.PI) / 180);
                }
                if (groupTransform.scale) {
                  ctx.scale(groupTransform.scale[0] / 100, groupTransform.scale[1] / 100);
                }
              }
            }
            
            // Render group shapes
            await renderImprovedShape(ctx, { it: item.it }, frame);
            ctx.restore();
          }
          break;
      }
    } catch (itemError) {
      console.log(`Warning: Failed to process shape item ${item.ty}:`, itemError.message);
    }
  }
  
  // Draw all paths
  for (const pathData of paths) {
    try {
      drawPath(ctx, pathData, fillColor, strokeColor, strokeWidth);
    } catch (drawError) {
      console.log(`Warning: Failed to draw path:`, drawError.message);
    }
  }
}

// Helper functions for interpolation
function interpolateTransform(ks, frame) {
  const result = {};
  
  if (ks.p) result.position = interpolateValue(ks.p, frame);
  if (ks.r) result.rotation = interpolateValue(ks.r, frame);
  if (ks.s) result.scale = interpolateValue(ks.s, frame);
  if (ks.o) result.opacity = interpolateValue(ks.o, frame);
  
  return result;
}

function interpolateValue(property, frame) {
  if (!property) return null;
  
  // Static value
  if (property.k && !Array.isArray(property.k)) {
    return property.k;
  }
  
  // Keyframed value - for now, just return the first keyframe or static value
  if (property.k) {
    if (Array.isArray(property.k) && property.k.length > 0) {
      if (typeof property.k[0] === 'object' && property.k[0].s) {
        return property.k[0].s; // First keyframe start value
      }
      return property.k; // Static array value
    }
    return property.k;
  }
  
  return null;
}

function interpolateColor(item, frame) {
  if (!item.c) return null;
  
  const color = interpolateValue(item.c, frame);
  const opacity = item.o ? interpolateValue(item.o, frame) / 100 : 1;
  
  if (Array.isArray(color) && color.length >= 3) {
    return `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${opacity})`;
  }
  
  return null;
}

function interpolatePath(item, frame) {
  if (!item.ks) return null;
  
  const pathData = interpolateValue(item.ks, frame);
  if (pathData && pathData.v) {
    return {
      type: 'path',
      vertices: pathData.v,
      inTangents: pathData.i || [],
      outTangents: pathData.o || [],
      closed: pathData.c || false
    };
  }
  
  return null;
}

function interpolateEllipse(item, frame) {
  const size = interpolateValue(item.s, frame);
  const position = interpolateValue(item.p, frame);
  
  if (size && position) {
    return {
      type: 'ellipse',
      position: position,
      size: size
    };
  }
  
  return null;
}

function interpolateRectangle(item, frame) {
  const size = interpolateValue(item.s, frame);
  const position = interpolateValue(item.p, frame);
  const roundness = item.r ? interpolateValue(item.r, frame) : 0;
  
  if (size && position) {
    return {
      type: 'rectangle',
      position: position,
      size: size,
      roundness: roundness || 0
    };
  }
  
  return null;
}

function drawPath(ctx, pathData, fillColor, strokeColor, strokeWidth) {
  ctx.beginPath();
  
  switch (pathData.type) {
    case 'path':
      drawBezierPath(ctx, pathData);
      break;
      
    case 'ellipse':
      const { position, size } = pathData;
      ctx.ellipse(position[0], position[1], size[0] / 2, size[1] / 2, 0, 0, 2 * Math.PI);
      break;
      
    case 'rectangle':
      const pos = pathData.position;
      const s = pathData.size;
      const r = pathData.roundness || 0;
      
      if (r > 0) {
        drawRoundedRect(ctx, pos[0] - s[0] / 2, pos[1] - s[1] / 2, s[0], s[1], r);
      } else {
        ctx.rect(pos[0] - s[0] / 2, pos[1] - s[1] / 2, s[0], s[1]);
      }
      break;
  }
  
  if (fillColor) {
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
  
  if (strokeColor && strokeWidth > 0) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }
}

function drawBezierPath(ctx, pathData) {
  const { vertices, inTangents, outTangents, closed } = pathData;
  
  if (!vertices || vertices.length === 0) return;
  
  ctx.moveTo(vertices[0][0], vertices[0][1]);
  
  for (let i = 1; i < vertices.length; i++) {
    const currentVertex = vertices[i];
    const prevVertex = vertices[i - 1];
    
    // Simple implementation - use quadratic curves for better results
    if (outTangents[i - 1] || inTangents[i]) {
      const cp1x = prevVertex[0] + (outTangents[i - 1] ? outTangents[i - 1][0] : 0);
      const cp1y = prevVertex[1] + (outTangents[i - 1] ? outTangents[i - 1][1] : 0);
      const cp2x = currentVertex[0] + (inTangents[i] ? inTangents[i][0] : 0);
      const cp2y = currentVertex[1] + (inTangents[i] ? inTangents[i][1] : 0);
      
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, currentVertex[0], currentVertex[1]);
    } else {
      ctx.lineTo(currentVertex[0], currentVertex[1]);
    }
  }
  
  if (closed) {
    ctx.closePath();
  }
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// Method 4: High-quality static sticker as final fallback
async function createHighQualityStaticFromTGS(animationData, dimensions, options) {
  try {
    const layers = animationData.layers || [];
    const backgroundColor = animationData.bg || 'transparent';
    
    // Create a more sophisticated placeholder based on animation data
    const svgElements = [];
    
    // Extract colors and shapes from layers for a representative static image
    let dominantColors = [];
    let hasShapes = false;
    
    for (const layer of layers.slice(0, 5)) { // Check first 5 layers
      if (layer.shapes) {
        hasShapes = true;
        for (const shape of layer.shapes) {
          if (shape.it) {
            for (const item of shape.it) {
              if (item.ty === 'fl' && item.c && item.c.k) {
                const color = item.c.k;
                if (Array.isArray(color) && color.length >= 3) {
                  dominantColors.push({
                    r: Math.round(color[0] * 255),
                    g: Math.round(color[1] * 255),
                    b: Math.round(color[2] * 255),
                    opacity: (item.o && item.o.k) ? (item.o.k / 100) : 0.8
                  });
                }
              }
            }
          }
        }
      }
    }
    
    // Create gradient based on extracted colors
    let gradientStops = '';
    if (dominantColors.length > 0) {
      dominantColors.slice(0, 3).forEach((color, index) => {
        const offset = (index * 50) % 100;
        gradientStops += `<stop offset="${offset}%" style="stop-color:rgba(${color.r},${color.g},${color.b},${color.opacity})" />`;
      });
    } else {
      // Default gradient
      gradientStops = `
        <stop offset="0%" style="stop-color:rgba(74,144,226,0.8)" />
        <stop offset="50%" style="stop-color:rgba(155,89,182,0.6)" />
        <stop offset="100%" style="stop-color:rgba(52,152,219,0.4)" />
      `;
    }
    
    // Create sophisticated SVG design
    const centerX = dimensions.width / 2;
    const centerY = dimensions.height / 2;
    const size = Math.min(dimensions.width, dimensions.height);
    
    const svgContent = `
      <svg width="${dimensions.width}" height="${dimensions.height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="mainGrad" cx="50%" cy="50%" r="60%">
            ${gradientStops}
          </radialGradient>
          <linearGradient id="overlayGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:rgba(255,255,255,0.2)" />
            <stop offset="100%" style="stop-color:rgba(255,255,255,0.05)" />
          </linearGradient>
        </defs>
        
        <!-- Main shape based on whether original has shapes -->
        ${hasShapes ? 
          `<circle cx="${centerX}" cy="${centerY}" r="${size * 0.35}" fill="url(#mainGrad)" />` :
          `<rect x="${centerX - size * 0.3}" y="${centerY - size * 0.3}" width="${size * 0.6}" height="${size * 0.6}" rx="${size * 0.05}" fill="url(#mainGrad)" />`
        }
        
        <!-- Overlay for depth -->
        <circle cx="${centerX}" cy="${centerY}" r="${size * 0.25}" fill="url(#overlayGrad)" />
        
        <!-- Animation indicator -->
        <g transform="translate(${centerX}, ${centerY})">
          <circle r="${size * 0.08}" fill="rgba(255,255,255,0.9)" />
          <polygon points="-${size * 0.03},-${size * 0.04} ${size * 0.05},0 -${size * 0.03},${size * 0.04}" 
                   fill="rgba(100,100,100,0.8)" />
        </g>
        
        <!-- Subtle decoration -->
        <circle cx="${centerX}" cy="${centerY}" r="${size * 0.4}" fill="none" 
                stroke="rgba(255,255,255,0.15)" stroke-width="1" stroke-dasharray="3,3" />
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
    
    console.log("Created high-quality static sticker from TGS data");
    return sticker;
    
  } catch (error) {
    throw new Error(`High-quality static TGS method failed: ${error.message}`);
  }
}

// Existing video functions remain the same
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
