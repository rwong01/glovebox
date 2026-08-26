/**
 * Browser camera and image-preparation helpers.
 *
 * Capture happens inside the app rather than by bouncing out to the phone's
 * camera app and picking files afterwards: scanning a shoebox of receipts is a
 * repetitive loop, and one tap per receipt is the whole point.
 */

/** Long-edge cap for what gets uploaded. Receipt text stays legible well below this. */
export const MAX_UPLOAD_EDGE = 1600
export const JPEG_QUALITY = 0.85
const THUMB_EDGE = 200

export function isCameraSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia)
}

/** Rear camera at a resolution high enough to read small print. */
export async function startCamera() {
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  })
}

export function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop())
}

/** Turns a getUserMedia error into something worth showing a person. */
export function describeCameraError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was blocked. Allow it in your browser settings, or upload photos instead.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera found on this device. Upload photos instead.'
    case 'NotReadableError':
      return 'Something else is using the camera. Close it and try again.'
    default:
      return err?.message || 'Could not open the camera.'
  }
}

function scaled(width, height, maxEdge) {
  const factor = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.round(width * factor), height: Math.round(height * factor) }
}

/** Draws any image source onto a canvas, scaled down to fit `maxEdge`. */
export function drawToCanvas(source, sourceWidth, sourceHeight, maxEdge = MAX_UPLOAD_EDGE) {
  const { width, height } = scaled(sourceWidth, sourceHeight, maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(source, 0, 0, width, height)
  return canvas
}

export function captureFromVideo(video, maxEdge = MAX_UPLOAD_EDGE) {
  const width = video.videoWidth
  const height = video.videoHeight
  if (!width || !height) throw new Error('The camera is not ready yet.')
  return drawToCanvas(video, width, height, maxEdge)
}

/** Decodes a picked file onto a canvas, honouring the same size cap. */
export async function fileToCanvas(file, maxEdge = MAX_UPLOAD_EDGE) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file)
    try {
      return drawToCanvas(bitmap, bitmap.width, bitmap.height, maxEdge)
    } finally {
      bitmap.close?.()
    }
  }

  // Older Safari.
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('That file could not be read as an image.'))
      element.src = url
    })
    return drawToCanvas(img, img.naturalWidth, img.naturalHeight, maxEdge)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Pixels for the quality check, downscaled to the width the thresholds in
 * `imageQuality.js` are calibrated against.
 */
export function analysisPixels(canvas, targetWidth) {
  const { width, height } = scaled(canvas.width, canvas.height, targetWidth)
  const small = document.createElement('canvas')
  small.width = width
  small.height = height
  const ctx = small.getContext('2d')
  ctx.drawImage(canvas, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

export function canvasToDataUrl(canvas, quality = JPEG_QUALITY) {
  return canvas.toDataURL('image/jpeg', quality)
}

/** A small preview kept after the full-size image is released from memory. */
export function canvasToThumbnail(canvas) {
  const { width, height } = scaled(canvas.width, canvas.height, THUMB_EDGE)
  const thumb = document.createElement('canvas')
  thumb.width = width
  thumb.height = height
  thumb.getContext('2d').drawImage(canvas, 0, 0, width, height)
  return thumb.toDataURL('image/jpeg', 0.7)
}
