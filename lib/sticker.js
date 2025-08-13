const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const sharp = require("sharp");
const ffmpeg = require("fluent-ffmpeg");
const { Sticker, StickerTypes } = require("wa-sticker-formatter");

// ⛑ opsional: lottie-node bisa saja tidak ada / beda versi.
// Kita require di dalam try agar tidak bikin crash kalau tidak tersedia.
let LOTTIE_NODE = null;
try { LOTTIE_NODE = require("lottie-node"); } catch (_) {}

const TEMP_DIR = path.join(os.tmpdir(), "sticker_temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

/* ---------- util ---------- */
function isGzip(buf) {
  return buf && buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}
function safeParseTGS(buffer) {
  let jsonBuf = buffer;
  try {
    if (isGzip(buffer)) jsonBuf = zlib.gunzipSync(buffer);
    const json = JSON.parse(jsonBuf.toString("utf8"));
    return json;
  } catch (e) {
    const err = new Error("TGS parse failed (gzip/JSON)");
    err.code = "TGS_PARSE";
    throw err;
  }
}
function fitSize(w, h, max = 512) {
  let W = w || 512, H = h || 512;
  if (W > max || H > max) {
    const r = Math.min(max / W, max / H);
    W = Math.round(W * r);
    H = Math.round(H * r);
  }
  // libwebp lebih aman dimensi genap
  if (W % 2) W -= 1;
  if (H % 2) H -= 1;
  return { width: Math.max(2, W), height: Math.max(2, H) };
}

/* ---------- video/gif → anim webp ---------- */
async function createStickerFromVideo(videoBuffer, stickerOptions = {}) {
  const inPath = path.join(TEMP_DIR, `in_${Date.now()}.mp4`);
  const outPath = path.join(TEMP_DIR, `out_${Date.now()}.webp`);
  fs.writeFileSync(inPath, videoBuffer);

  await new Promise((resolve, reject) => {
    ffmpeg(inPath)
      .outputOptions([
        "-vcodec", "libwebp",
        "-vf", "scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
        "-loop", "0",
        "-preset", "default",
        "-an",
        "-vsync", "0"
      ])
      .save(outPath)
      .on("end", resolve)
      .on("error", reject);
  });

  const buf = fs.readFileSync(outPath);
  try { fs.unlinkSync(inPath); } catch {}
  try { fs.unlinkSync(outPath); } catch {}
  return new Sticker(buf, { ...stickerOptions, type: StickerTypes.FULL, background: "transparent" });
}

/* ---------- TGS → anim webp (lottie-node) + fallback ---------- */
async function createStickerFromTGS(tgsBuffer, stickerOptions = {}) {
  const anim = safeParseTGS(tgsBuffer);
  const { width, height } = fitSize(anim.w, anim.h, 512);

  // Coba render animasi via lottie-node jika tersedia
  if (LOTTIE_NODE && typeof LOTTIE_NODE.render === "function") {
    try {
      // Beberapa implementasi lottie-node menyediakan API async render(json, {w,h,fps})
      const fps = Math.max(10, Math.min(30, Math.round((anim.fr || 30))));
      const frames = await LOTTIE_NODE.render(anim, { width, height, fps }); 
      // `frames` diasumsikan array Buffer PNG per-frame.
      // Jika implementasimu berbeda, gantilah bagian ini sesuai API lottie-node yang kamu pakai.

      // Tulis ke disk sementara
      const pattern = path.join(TEMP_DIR, `tgs_${Date.now()}_%05d.png`);
      for (let i = 0; i < frames.length; i++) {
        const p = pattern.replace("%05d", String(i));
        fs.writeFileSync(p, frames[i]);
      }

      const outPath = path.join(TEMP_DIR, `tgs_${Date.now()}.webp`);
      await new Promise((resolve, reject) => {
        ffmpeg(path.join(TEMP_DIR, `tgs_${Date.now()}_%05d.png`)) // wildcard tidak berlaku; kita glob manual:
          .inputOptions([`-pattern_type`, `glob`])
          .input(path.join(TEMP_DIR, `tgs_*_*.png`))
          .outputOptions([
            "-vcodec", "libwebp",
            "-vf", `scale=${width}:${height}:flags=lanczos,format=rgba`,
            "-r", String(fps),
            "-loop", "0",
            "-preset", "default",
            "-an",
            "-vsync", "0"
          ])
          .save(outPath)
          .on("end", resolve)
          .on("error", reject);
      });

      const webp = fs.readFileSync(outPath);
      // bersihkan png frame
      fs.readdirSync(TEMP_DIR).forEach(f => { if (f.startsWith("tgs_") && f.endsWith(".png")) try { fs.unlinkSync(path.join(TEMP_DIR, f)); } catch {} });
      try { fs.unlinkSync(outPath); } catch {}

      return new Sticker(webp, { ...stickerOptions, type: StickerTypes.FULL, background: "transparent" });
    } catch (e) {
      // lanjut ke fallback statis
    }
  }

  // Fallback: kirim statis transparan sesuai rasio
  const png = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).png().toBuffer();

  return new Sticker(png, { ...stickerOptions, type: StickerTypes.FULL, background: "transparent" });
}

/* ---------- Static preview untuk thumbnail ---------- */
async function createStaticPreviewFromTGS(tgsBuffer) {
  // Kita hanya butuh ukuran; jika parsing gagal, pakai default 512x512 transparan
  let w = 512, h = 512;
  try {
    const anim = safeParseTGS(tgsBuffer);
    const s = fitSize(anim.w, anim.h, 512);
    w = s.width; h = s.height;
  } catch (_) {}
  return sharp({
    create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).png().toBuffer();
}

module.exports = {
  createStickerFromVideo,
  createStickerFromTGS,
  createStaticPreviewFromTGS
};
