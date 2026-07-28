// worker/src/face-detect.js — YuNet face detection in Node (onnxruntime-node).
//
// Used by photo-quality selection to rank a HUMAN subject's uploaded photos by
// face size, so the mint anchors on the clear-face photos instead of all-or-first
// (see run-pipeline selectBestPhotos). Our use is COARSE — "is the face big or
// small?" — not pixel-perfect boxes, which is why the letterbox+decode port below
// is safe: the ranking is robust to sub-pixel differences (calibration cliff is ~3.5x).
//
// The model (worker/src/models/yunet.onnx) is the same YuNet the Python calibration
// used (scripts/_cv/yunet.onnx); a parity test asserts the JS decode reproduces the
// Python ranking on Nicki's 4 photos.
//
// YuNet output = 3 strides (8/16/32), each with cls/obj/bbox/kps heads. We decode
// bbox + score = sqrt(cls*obj), NMS, and return faces in ORIGINAL image coordinates.
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODEL_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "models", "yunet.onnx");
const INPUT = 640;                 // square letterbox size (fixed grids: 80/40/20)
const STRIDES = [8, 16, 32];
const SCORE_THRESHOLD = 0.3;       // matches the Python FaceDetectorYN score_threshold
const NMS_IOU = 0.3;

let _session = null;
let _ort = null;
// Lazy so the worker (and its test suite) only load the native runtime + model when a
// photo-anchored HUMAN subject actually needs ranking. Pets never trigger it.
async function session() {
  if (!_session) {
    _ort = _ort ?? (await import("onnxruntime-node"));
    _session = await _ort.InferenceSession.create(MODEL_PATH);
  }
  return _session;
}

// Letterbox a PNG/JPEG buffer to INPUT×INPUT (aspect-preserving, top-left aligned,
// zero-padded), returning a BGR NCHW float32 tensor + the scale to map boxes back.
async function preprocess(buf, sharp) {
  const img = sharp(buf).removeAlpha();
  const meta = await img.metadata();
  const W = meta.width, H = meta.height;
  const scale = Math.min(INPUT / W, INPUT / H);
  const nW = Math.max(1, Math.round(W * scale));
  const nH = Math.max(1, Math.round(H * scale));
  const rgb = await sharp(buf).removeAlpha().resize(nW, nH, { fit: "fill" }).raw().toBuffer(); // RGB, row-major
  const plane = INPUT * INPUT;
  const data = new Float32Array(3 * plane); // zero-padded by construction
  for (let y = 0; y < nH; y++) {
    for (let x = 0; x < nW; x++) {
      const p = (y * nW + x) * 3;
      const idx = y * INPUT + x;
      data[idx] = rgb[p + 2];              // B
      data[plane + idx] = rgb[p + 1];      // G
      data[2 * plane + idx] = rgb[p];      // R
    }
  }
  return { data, W, H, scale };
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
}

function nms(boxes) {
  const kept = [];
  for (const b of boxes.sort((p, q) => q.score - p.score)) {
    if (kept.every((k) => iou(b, k) < NMS_IOU)) kept.push(b);
  }
  return kept;
}

/**
 * Detect faces in an image buffer. Returns faces in ORIGINAL coordinates, each
 * { x, y, w, h, score, faceH } where faceH = box height / image height (the size
 * signal). `deps.sharp` injectable for tests; defaults to the root `sharp`.
 */
export async function detectFaces(buf, deps = {}) {
  const sharp = deps.sharp ?? (await import("sharp")).default;
  const sess = await session();
  const { data, W, H, scale } = await preprocess(buf, sharp);
  const Tensor = _ort.Tensor;
  const feeds = { [sess.inputNames[0]]: new Tensor("float32", data, [1, 3, INPUT, INPUT]) };
  const out = await sess.run(feeds);

  const boxes = [];
  for (const s of STRIDES) {
    const cls = out[`cls_${s}`].data, obj = out[`obj_${s}`].data, bbox = out[`bbox_${s}`].data;
    const gs = INPUT / s; // grid side (80/40/20)
    const n = gs * gs;
    for (let i = 0; i < n; i++) {
      const score = Math.sqrt(clamp01(cls[i]) * clamp01(obj[i]));
      if (score < SCORE_THRESHOLD) continue;
      const col = i % gs, row = Math.floor(i / gs);
      const cx = (col + bbox[i * 4]) * s;
      const cy = (row + bbox[i * 4 + 1]) * s;
      const w = Math.exp(bbox[i * 4 + 2]) * s;
      const h = Math.exp(bbox[i * 4 + 3]) * s;
      boxes.push({ x: cx - w / 2, y: cy - h / 2, w, h, score });
    }
  }
  // NMS in letterbox space, then map back to original coordinates.
  return nms(boxes).map((b) => ({
    x: b.x / scale, y: b.y / scale, w: b.w / scale, h: b.h / scale,
    score: b.score, faceH: (b.h / scale) / H,
  }));
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/**
 * Face-quality score for ONE photo = the LARGEST face's (faceH × confidence), with
 * frontalness NOT used (calibration: it's noise; size dominates). Returns 0 when no
 * face is found (e.g. a pet photo, or a photo with no clear human face).
 */
export async function photoFaceQuality(buf, deps = {}) {
  const faces = await detectFaces(buf, deps);
  if (!faces.length) return { quality: 0, faceH: 0, score: 0, faces: 0 };
  const best = faces.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a)); // largest = the subject
  return { quality: best.faceH * best.score, faceH: best.faceH, score: best.score, faces: faces.length };
}
