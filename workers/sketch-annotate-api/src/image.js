function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

/** @returns {string|null} image/jpeg | image/png | null */
export function detectImageMime(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  return null;
}

/**
 * @param {File|Blob} file
 * @returns {Promise<string>} data:image/jpeg|png;base64,...
 */
export async function fileToDataUri(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 16) {
    const err = new Error('图片文件无效或过小');
    err.httpStatus = 400;
    err.code = 'INVALID_IMAGE_FORMAT';
    throw err;
  }

  const mime = detectImageMime(bytes);
  if (!mime) {
    const err = new Error('仅支持 JPG/PNG 图片（HEIC/WebP 等请先转换）');
    err.httpStatus = 400;
    err.code = 'INVALID_IMAGE_FORMAT';
    throw err;
  }

  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/**
 * OpenRouter 可能返回 data URL 或 https 临时链接；统一转为 data URL 再回传前端。
 * @param {string} urlOrDataUri
 * @returns {Promise<string>}
 */
export async function ensureDataUri(urlOrDataUri) {
  const raw = (urlOrDataUri || '').trim();
  if (!raw) {
    const err = new Error('OpenRouter 未返回图片');
    err.httpStatus = 502;
    err.code = 'NO_IMAGE';
    throw err;
  }
  if (raw.startsWith('data:image/')) return raw;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    const err = new Error('OpenRouter 返回的图片地址无效');
    err.httpStatus = 502;
    err.code = 'NO_IMAGE';
    throw err;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    const err = new Error('OpenRouter 返回的图片地址无效');
    err.httpStatus = 502;
    err.code = 'NO_IMAGE';
    throw err;
  }

  const res = await fetch(raw);
  if (!res.ok) {
    const err = new Error(`拉取生成图失败（HTTP ${res.status}）`);
    err.httpStatus = 502;
    err.code = 'IMAGE_FETCH_FAILED';
    throw err;
  }
  const blob = await res.blob();
  const headerMime = (res.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (headerMime === 'image/jpeg' || headerMime === 'image/png') {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    return `data:${headerMime};base64,${bytesToBase64(bytes)}`;
  }
  return fileToDataUri(blob);
}
