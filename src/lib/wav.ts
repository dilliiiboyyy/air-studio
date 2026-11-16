/** Encode planar float channels to a 16-bit PCM WAV blob. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const nCh = channels.length;
  const len = channels[0]?.length ?? 0;
  const buf = new ArrayBuffer(44 + len * nCh * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + len * nCh * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nCh * 2, true); v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, len * nCh * 2, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nCh; c++) {
      let s = channels[c][i];
      s = s < -1 ? -1 : s > 1 ? 1 : s;
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export const audioBufferToWav = (b: AudioBuffer) =>
  encodeWav(Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i)), b.sampleRate);

const decodeCache = new WeakMap<Blob, Promise<AudioBuffer>>();
export function decodeBlob(ctx: BaseAudioContext, blob: Blob): Promise<AudioBuffer> {
  let p = decodeCache.get(blob);
  if (!p) {
    p = blob.arrayBuffer().then((ab) => ctx.decodeAudioData(ab));
    decodeCache.set(blob, p);
  }
  return p;
}
