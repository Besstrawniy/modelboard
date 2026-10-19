/** Deterministic, locally generated loops: no third-party media or network request. */
export function ambientMusic(track: string) {
  const rate = 8000,
    duration = 24,
    length = rate * duration;
  const buffer = new ArrayBuffer(44 + length * 2),
    view = new DataView(buffer);
  const label = (offset: number, text: string) =>
    [...text].forEach((char, i) =>
      view.setUint8(offset + i, char.charCodeAt(0)),
    );
  label(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  label(8, 'WAVE');
  label(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  label(36, 'data');
  view.setUint32(40, length * 2, true);
  let seed = 1234567,
    filtered = 0;
  for (let i = 0; i < length; i++) {
    const t = i / rate,
      part = t % 12;
    const envelope = Math.min(1, part / 1.5, (12 - part) / 1.5);
    const chord =
      t < 12 ? [130.8128, 164.8138, 195.9977] : [110, 130.8128, 164.8138];
    let sample = 0;
    if (track === 'rain') {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      filtered = filtered * 0.72 + (seed / 2147483648) * 0.28;
      sample = filtered * 0.6 * Math.min(1, t / 0.3, (duration - t) / 0.3);
    } else {
      sample =
        chord.reduce(
          (sum, frequency) =>
            sum +
            Math.sin(2 * Math.PI * frequency * t) +
            0.18 * Math.sin(4 * Math.PI * frequency * t),
          0,
        ) *
        0.055 *
        envelope;
      if (track === 'focus') {
        const note = chord[Math.floor(t * 2) % 3] * 2;
        sample +=
          Math.sin(2 * Math.PI * note * t) *
          Math.exp(-8 * (t % 0.5)) *
          0.09 *
          envelope;
      }
    }
    view.setInt16(
      44 + i * 2,
      Math.round(Math.max(-1, Math.min(1, sample)) * 32767),
      true,
    );
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
