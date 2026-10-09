/** Accepted upload image types (content-type → file extension) and the size cap. */
export const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const imageType = (path: string) =>
  Object.entries(IMAGE_TYPES).find(([, ext]) => path.endsWith(`.${ext}`))?.[0];
