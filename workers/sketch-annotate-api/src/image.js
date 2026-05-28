function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    for (let j = 0; j < slice.length; j++) {
      binary += String.fromCharCode(slice[j]);
    }
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
