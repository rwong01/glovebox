/**
 * Client-side capture quality check.
 *
 * Runs on every frame the moment it is captured, before anything is sent for
 * extraction. Catching a bad photo here is worth doing for its own sake — the
 * user is still standing in front of the receipt and can simply take another —
 * whereas catching it after extraction means a wasted API call and a garbage
 * record to clean up later.
 *
 * The measure is Laplacian variance: convolve with a discrete Laplacian and
 * look at how much the response varies. A sharp photo has strong edges and so
 * a high variance; a blurred one has smeared edges and a low one. It is the
 * standard cheap sharpness estimator and needs no libraries.
 *
 * All functions here are pure and take a plain `{ data, width, height }`, so
 * they can be tested without a canvas.
 */

/** Analysis runs on a downscaled copy; thresholds below are tuned to this width. */
export const ANALYSIS_WIDTH = 480

/**
 * Below this, a document photo is too soft to read reliably.
 *
 * Calibrated to be permissive on purpose. A false reject costs the user a
 * retake of a photo that would have worked; being strict about a legible-but-
 * imperfect shot is more annoying than letting the model try. The vision step
 * reports its own confidence as a second line of defence.
 */
export const SHARPNESS_THRESHOLD = 55

/** Standard deviation of luminance. A blank wall or a washed-out flash photo. */
export const CONTRAST_THRESHOLD = 16

/** Mean luminance bounds, 0-255. Outside these, exposure has failed. */
export const MIN_BRIGHTNESS = 28
export const MAX_BRIGHTNESS = 240

export const PROBLEMS = {
  BLURRY: 'blurry',
  DARK: 'dark',
  BRIGHT: 'bright',
  FLAT: 'flat',
}

const MESSAGES = {
  [PROBLEMS.BLURRY]: 'This looks blurry — hold steady and try again.',
  [PROBLEMS.DARK]: 'This came out too dark to read. More light, or move out of your own shadow.',
  [PROBLEMS.BRIGHT]: 'This is washed out — try angling away from the glare.',
  [PROBLEMS.FLAT]: "There's not much contrast here. Make sure the whole receipt is in frame.",
}

/** Rec. 601 luma, which is what these estimators are conventionally built on. */
export function toGrayscale({ data, width, height }) {
  const gray = new Float32Array(width * height)
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
  }
  return gray
}

/**
 * Variance of the 4-neighbour Laplacian response, skipping the border where
 * the kernel would read outside the image.
 */
export function laplacianVariance(gray, width, height) {
  if (width < 3 || height < 3) return 0

  let sum = 0
  let sumSquares = 0
  let count = 0

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x
      const response =
        -4 * gray[i] + gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width]
      sum += response
      sumSquares += response * response
      count += 1
    }
  }

  if (count === 0) return 0
  const mean = sum / count
  return Math.max(0, sumSquares / count - mean * mean)
}

export function luminanceStats(gray) {
  let sum = 0
  for (let i = 0; i < gray.length; i += 1) sum += gray[i]
  const mean = sum / gray.length

  let variance = 0
  for (let i = 0; i < gray.length; i += 1) variance += (gray[i] - mean) ** 2
  variance /= gray.length

  return { mean, stdDev: Math.sqrt(variance) }
}

/**
 * @param {{data: Uint8ClampedArray, width: number, height: number}} imageData
 * @returns {{ok: boolean, problem: string|null, message: string|null, sharpness: number, contrast: number, brightness: number}}
 */
export function assessCapture(imageData) {
  const gray = toGrayscale(imageData)
  const sharpness = laplacianVariance(gray, imageData.width, imageData.height)
  const { mean: brightness, stdDev: contrast } = luminanceStats(gray)

  // Exposure is checked first: a photo that is too dark or blown out will also
  // measure as blurry, and "too dark" is the more useful thing to be told.
  let problem = null
  if (brightness < MIN_BRIGHTNESS) problem = PROBLEMS.DARK
  else if (brightness > MAX_BRIGHTNESS) problem = PROBLEMS.BRIGHT
  else if (contrast < CONTRAST_THRESHOLD) problem = PROBLEMS.FLAT
  else if (sharpness < SHARPNESS_THRESHOLD) problem = PROBLEMS.BLURRY

  return {
    ok: problem === null,
    problem,
    message: problem ? MESSAGES[problem] : null,
    sharpness: Math.round(sharpness),
    contrast: Math.round(contrast),
    brightness: Math.round(brightness),
  }
}
