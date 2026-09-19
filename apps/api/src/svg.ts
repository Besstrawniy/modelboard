export function validateWorkspaceSvg(input: string) {
  const svg = input.trim();

  if (!svg) {
    throw new Error('SVG is empty');
  }

  if (Buffer.byteLength(svg, 'utf8') > 250 * 1024) {
    throw new Error('SVG is larger than 250 KB');
  }

  if (!/^<svg\b/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) {
    throw new Error('File must contain one SVG document');
  }

  const forbidden = [
    /<!DOCTYPE/i,
    /<!ENTITY/i,
    /<script\b/i,
    /<foreignObject\b/i,
    /<iframe\b/i,
    /<object\b/i,
    /<embed\b/i,
    /<audio\b/i,
    /<video\b/i,
    /<style\b/i,
    /\son[a-z]+\s*=/i,
    /javascript\s*:/i,
    /vbscript\s*:/i,
    /data\s*:\s*text\/html/i,
    /\b(?:href|xlink:href)\s*=\s*["']\s*(?:https?:|\/\/)/i,
    /url\s*\(\s*["']?(?:https?:|\/\/)/i,
  ];

  if (forbidden.some((pattern) => pattern.test(svg))) {
    throw new Error(
      'SVG contains unsafe or externally-referenced content',
    );
  }

  return svg;
}
