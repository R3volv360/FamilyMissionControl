/**
 * Photos are shrunk in the browser before upload (spec T7): a phone photo is often 4–12 MB, which is slow
 * over Wi-Fi and far bigger than the app ever shows. The longest side becomes at most MAX_SIDE, saved as JPEG.
 * The browser decodes whatever the camera produced (including iPhone HEIC in Safari).
 */
export const MAX_SIDE = 1600
const QUALITY = 0.85

export async function shrinkPhoto(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error("That file couldn't be read as a photo")
  })
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error("This browser can't prepare photos")
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
  if (!blob) throw new Error("This browser can't prepare photos")
  return blob
}

/** An object URL for a Blob, made once per Blob. Not revoked: the editor keeps every photo Blob alive anyway
 * (state and draft), and revoking on unmount breaks React's dev double-mount. */
const urls = new WeakMap<Blob, string>()

export function objectUrl(blob: Blob): string {
  let url = urls.get(blob)
  if (!url) {
    url = URL.createObjectURL(blob)
    urls.set(blob, url)
  }
  return url
}
