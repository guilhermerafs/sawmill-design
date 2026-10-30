// Offline video export: renders every frame at full quality at a fixed timestep (t = i / fps),
// independent of how fast this machine draws, and encodes with WebCodecs into an MP4.
import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer.mjs';

const CODECS = [
  { codec: 'avc1.640034', mux: 'avc' },
  { codec: 'avc1.4d0034', mux: 'avc' },
  { codec: 'vp09.00.50.08', mux: 'vp9' },
];

export const exportSupported = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

async function pickCodec(width, height, fps, bitrate) {
  for (const c of CODECS) {
    const cfg = { codec: c.codec, width, height, framerate: fps, bitrate, latencyMode: 'quality' };
    try {
      const r = await VideoEncoder.isConfigSupported(cfg);
      if (r.supported) return { ...c, cfg };
    } catch { /* try next */ }
  }
  return null;
}

// renderFrame(i, t, dt) must draw frame i onto `canvas` synchronously.
// Returns a Blob (video/mp4). Rejects with Error('cancelled') if signal aborts.
export async function exportVideo({ canvas, fps, seconds, bitrate, renderFrame, onProgress, signal }) {
  const width = canvas.width & ~1, height = canvas.height & ~1;
  const picked = await pickCodec(width, height, fps, bitrate);
  if (!picked) throw new Error('This browser has no H.264/VP9 encoder for this size (try Chrome, Edge or Safari).');

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: picked.mux, width, height, frameRate: fps },
    fastStart: 'in-memory',
  });
  let encError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encError = e; },
  });
  encoder.configure(picked.cfg);

  const total = Math.round(fps * seconds);
  const t0 = performance.now();
  try {
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new Error('cancelled');
      if (encError) throw encError;
      renderFrame(i, i / fps, 1 / fps);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      // Backpressure + let the page repaint the progress bar.
      while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
      if (i % 2 === 1 || i === total - 1) {
        const el = (performance.now() - t0) / 1000;
        onProgress?.(i + 1, total, ((i + 1) / el) ? (total - i - 1) / ((i + 1) / el) : 0);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    await encoder.flush();
    if (encError) throw encError;
    muxer.finalize();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  return new Blob([target.buffer], { type: 'video/mp4' });
}
