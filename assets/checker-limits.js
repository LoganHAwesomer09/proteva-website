// Leave room for base64 expansion and JSON below Vercel's 4.5 MB request limit.
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_CHECK_BYTES = 4300000;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
