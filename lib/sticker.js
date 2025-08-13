const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const { Sticker, StickerTypes } = require("wa-sticker-formatter");
const zlib = require('zlib');
const sharp = require('sharp');
const puppeteer = require('puppeteer');

const TEMP_DIR = path.join(__dirname, "../temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// 🔹 Deteksi format file
function detectFileFormat(buffer) {
  if (!buffer || buffer.length < 12) return 'unknown';
  const header = buffer.toString('hex', 0, 12).toLowerCase();
  if (header.startsWith('1a45dfa3')) return 'webm';
  if (header.includes('66747970') || header.startsWith('000000') || 
      header.includes('6d6f6f76') || header.includes('6d646174')) return 'mp4';
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) return 'tgs-compressed';
  if (buffer.toString('utf8', 0, 10).includes('{')) return 'tgs';
  if (header.includes('52494646') && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (header.startsWith('89504e47')) return 'png';
  if (header.startsWith('ffd8ff')) return 'jpeg';
  return 'unknown';
}

// 🔹 Ambil dimensi animasi
function getAnimationDimensions(animationData) {
  const width = animationData.w || 512;
  const height = animationData.h || 512;
  let finalWidth = width;
  let finalHeight = height;

  if (width > 512 || height > 512) {
    const ratio = Math.min(512 / width, 512 / height);
    finalWidth = Math.round(width * ratio);
    finalHeight = Math.round(height * ratio);
  }
  finalWidth = finalWidth % 2 === 0 ? finalWidth : finalWidth - 1;
  finalHeight = finalHeight % 2 === 0 ? finalHeight : finalHeight - 1;
  return { width: finalWidth, height: finalHeight, originalWidth: width, originalHeight: height };
}

// 🆕 Konversi TGS → WebP animasi via Puppeteer
async function createTGSWithPuppeteer(jsonBuffer, dimensions, options) {
  const tempJsonPath = path.join(TEMP_DIR, `tgs_${Date.now()}.json`);
  const tempWebmPath = path.join(TEMP_DIR, `tgs_${Date.now()}.webm`);
  const tempWebpPath = path.join(TEMP_DIR, `tgs_${Date.now()}.webp`);

  fs.writeFileSync(tempJsonPath, jsonBuffer);

  try {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();

    await page.setViewport({ width: dimensions.width, height: dimensions.height, deviceScaleFactor: 1 });

    await page.setContent(`
      <html>
        <body style="margin:0;background:transparent;overflow:hidden;">
          <div id="lottie"></div>
          <script src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.10.2/lottie.min.js"></script>
          <script>
            const animData = ${JSON.stringify(JSON.parse(jsonBuffer.toString()))};
            const anim = lottie.loadAnimation({
              container: document.getElementById('lottie'),
              renderer: 'canvas',
              loop: false,
              autoplay: true,
              animationData: animData
            });
          </script>
        </body>
      </html>
    `);

    // Rekam animasi jadi WebM transparan
    const client = await page.target().createCDPSession();
    await client.send('Page.startScreencast', {
      format: 'webm',
      everyNthFrame: 1,
      quality: 100
    });

    const chunks = [];
    client.on('Page.screencastFrame', async (frame) => {
      chunks.push(Buffer.from(frame.data, 'base64'));
      await client.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
    });

    await new Promise(res => setTimeout(res, 3000)); // Tunggu animasi selesai
    await client.send('Page.stopScreencast');
    await browser.close();

    fs.writeFileSync(tempWebmPath, Buffer.concat(chunks));

    // WebM → WebP
    await new Promise((resolve, reject) => {
      ffmpeg(tempWebmPath)
        .outputOptions([
          '-vcodec', 'libwebp',
          `-vf`, `scale=${dimensions.width}:${dimensions.height}:flags=lanczos,format=rgba`,
          '-loop', '0',
          '-lossless', '0',
          '-quality', '85',
          '-method', '6'
        ])
        .save(tempWebpPath)
        .on('end', resolve)
        .on('error', reject);
    });

    const webpBuffer = fs.readFileSync(tempWebpPath);
    return new Sticker(webpBuffer, { ...options, background: 'transparent', type: StickerTypes.FULL });

  } finally {
    [tempJsonPath, tempWebmPath, tempWebpPath].forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
  }
}

// 🔹 Fallback static
async function createAdvancedStaticFromTGS(animationData, dimensions, options) {
  const pngBuffer = await sharp({
    create: {
      width: dimensions.width,
      height: dimensions.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  }).png().toBuffer();

  return new Sticker(pngBuffer, { ...options, background: 'transparent', type: StickerTypes.FULL });
}

// 🔹 Fungsi utama buat TGS
async function createStickerFromTGS(tgsBuffer, options) {
  let processedBuffer = tgsBuffer;
  if (tgsBuffer[0] === 0x1f && tgsBuffer[1] === 0x8b) {
    processedBuffer = zlib.gunzipSync(tgsBuffer);
  }
  const animationData = JSON.parse(processedBuffer.toString('utf8'));
  const dimensions = getAnimationDimensions(animationData);

  try {
    return await createTGSWithPuppeteer(processedBuffer, dimensions, options);
  } catch (err) {
    console.log("Puppeteer method failed:", err.message);
  }

  return await createAdvancedStaticFromTGS(animationData, dimensions, options);
}

// 🔹 Fungsi video → WebP
async function createStickerFromVideo(videoBuffer, options = {}) {
  if (!videoBuffer || videoBuffer.length === 0) throw new Error("Video buffer kosong");
  const detectedFormat = detectFileFormat(videoBuffer);

  const fileExt = detectedFormat === 'webm' ? '.webm' : '.mp4';
  const tempInputPath = path.join(TEMP_DIR, `vid_${Date.now()}${fileExt}`);
  const tempOutputPath = path.join(TEMP_DIR, `vid_${Date.now()}.webp`);

  try {
    fs.writeFileSync(tempInputPath, videoBuffer);

    await new Promise((resolve, reject) => {
      ffmpeg(tempInputPath)
        .outputOptions([
          '-vcodec', 'libwebp',
          '-vf', `scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=15`,
          '-loop', '0',
          '-lossless', '0',
          '-quality', '90',
          '-method', '6'
        ])
        .save(tempOutputPath)
        .on('end', resolve)
        .on('error', reject);
    });

    const webpBuffer = fs.readFileSync(tempOutputPath);
    return new Sticker(webpBuffer, { ...options, background: 'transparent', type: StickerTypes.FULL });

  } finally {
    [tempInputPath, tempOutputPath].forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
  }
}

module.exports = {
  createStickerFromVideo,
  createStickerFromTGS
};
