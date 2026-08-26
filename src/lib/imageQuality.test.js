import { describe, expect, it } from 'vitest'

import {
  PROBLEMS,
  assessCapture,
  laplacianVariance,
  luminanceStats,
  toGrayscale,
} from './imageQuality.js'

/** Builds an ImageData-shaped object from a per-pixel grey value function. */
function image(width, height, valueAt) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = valueAt(x, y)
      const p = (y * width + x) * 4
      data[p] = v
      data[p + 1] = v
      data[p + 2] = v
      data[p + 3] = 255
    }
  }
  return { data, width, height }
}

/** Hard-edged stripes: a stand-in for crisp printed text. */
const sharpDocument = (w = 64, h = 64) => image(w, h, (x) => ((x >> 1) % 2 ? 235 : 20))

/** The same stripes smeared into a gradient: the same content, out of focus. */
const blurredDocument = (w = 64, h = 64) =>
  image(w, h, (x) => 128 + 100 * Math.sin((x / w) * Math.PI * 4))

describe('grayscale', () => {
  it('weights the channels by luma rather than averaging them', () => {
    const data = new Uint8ClampedArray([0, 255, 0, 255])
    const [green] = toGrayscale({ data, width: 1, height: 1 })
    expect(green).toBeCloseTo(149.685, 2) // 0.587 * 255
  })
})

describe('sharpness', () => {
  it('scores a hard-edged image far above a smeared one', () => {
    const sharp = toGrayscale(sharpDocument())
    const blurred = toGrayscale(blurredDocument())

    const sharpScore = laplacianVariance(sharp, 64, 64)
    const blurredScore = laplacianVariance(blurred, 64, 64)

    expect(sharpScore).toBeGreaterThan(blurredScore * 10)
  })

  it('scores a flat image at zero', () => {
    expect(laplacianVariance(toGrayscale(image(32, 32, () => 128)), 32, 32)).toBe(0)
  })

  it('handles an image too small to convolve', () => {
    expect(laplacianVariance(new Float32Array(4), 2, 2)).toBe(0)
  })
})

describe('luminance', () => {
  it('reports mean and spread', () => {
    const { mean, stdDev } = luminanceStats(toGrayscale(image(2, 1, (x) => (x === 0 ? 0 : 200))))
    expect(mean).toBeCloseTo(100, 0)
    expect(stdDev).toBeCloseTo(100, 0)
  })
})

describe('capture assessment', () => {
  it('accepts a crisp, well-exposed document', () => {
    const result = assessCapture(sharpDocument())
    expect(result.ok).toBe(true)
    expect(result.problem).toBeNull()
  })

  it('rejects a blurred capture with a message about blur', () => {
    const result = assessCapture(blurredDocument())
    expect(result.ok).toBe(false)
    expect(result.problem).toBe(PROBLEMS.BLURRY)
    expect(result.message).toMatch(/blurry/i)
  })

  it('reports darkness rather than blur when the photo is underexposed', () => {
    // Genuinely sharp edges, but far too dark to read.
    const result = assessCapture(image(64, 64, (x) => ((x >> 1) % 2 ? 22 : 2)))
    expect(result.problem).toBe(PROBLEMS.DARK)
  })

  it('reports a blown-out capture', () => {
    expect(assessCapture(image(64, 64, () => 252)).problem).toBe(PROBLEMS.BRIGHT)
  })

  it('reports a flat, featureless frame', () => {
    expect(assessCapture(image(64, 64, () => 130)).problem).toBe(PROBLEMS.FLAT)
  })

  it('always returns the numbers behind the verdict', () => {
    const result = assessCapture(sharpDocument())
    expect(Number.isFinite(result.sharpness)).toBe(true)
    expect(Number.isFinite(result.contrast)).toBe(true)
    expect(Number.isFinite(result.brightness)).toBe(true)
  })
})
