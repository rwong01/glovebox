import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Check, ImageUp, RotateCcw, X } from 'lucide-react'

import { extractReceipt, saveRecord } from '../lib/api.js'
import {
  analysisPixels,
  canvasToDataUrl,
  canvasToThumbnail,
  captureFromVideo,
  describeCameraError,
  fileToCanvas,
  isCameraSupported,
  startCamera,
  stopStream,
} from '../lib/camera.js'
import { ANALYSIS_WIDTH, assessCapture } from '../lib/imageQuality.js'
import { cn } from '../lib/cn.js'
import { Button } from './ui/Button.jsx'
import { ErrorNote } from './ui/States.jsx'

let nextId = 0

const STATUS_LABEL = {
  queued: 'Waiting',
  reading: 'Reading…',
  saving: 'Saving…',
  saved: 'Saved',
  failed: 'Failed',
}

/**
 * The scanning flow: capture, check, extract, save.
 *
 * Two things shape the design. First, a bad photo is caught the moment it is
 * taken, while the receipt is still in front of you — a retake then costs
 * nothing, and a retake an hour later costs the whole trip to the shoebox.
 * Second, extraction runs in the background while you keep shooting, so the
 * queue never blocks the next capture.
 */
export function ReceiptUploader({ vehicleId, itemKeys, onSaved }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const fileInputRef = useRef(null)
  const workingRef = useRef(false)

  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState(null)
  const [starting, setStarting] = useState(false)
  const [pending, setPending] = useState(null) // a capture that failed the check
  const [items, setItems] = useState([])

  const stopCamera = useCallback(() => {
    stopStream(streamRef.current)
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraOn(false)
  }, [])

  // Releasing the camera when the component goes away matters: on a phone the
  // recording indicator stays lit otherwise.
  useEffect(() => stopCamera, [stopCamera])

  async function openCamera() {
    setCameraError(null)
    setStarting(true)
    try {
      streamRef.current = await startCamera()
      setCameraOn(true)
    } catch (err) {
      setCameraError(describeCameraError(err))
    } finally {
      setStarting(false)
    }
  }

  // The <video> mounts only once `cameraOn` flips, and unmounts again while a
  // retake prompt is showing, so the stream is attached after every commit that
  // brings it back rather than once when the camera opens.
  useEffect(() => {
    if (!cameraOn || pending || !videoRef.current || !streamRef.current) return
    videoRef.current.srcObject = streamRef.current
    videoRef.current.play?.().catch(() => {})
  }, [cameraOn, pending])

  /** Downscales, encodes, and runs the quality gate. */
  const prepare = useCallback(
    (canvas) => ({
      dataUrl: canvasToDataUrl(canvas),
      thumb: canvasToThumbnail(canvas),
      quality: assessCapture(analysisPixels(canvas, ANALYSIS_WIDTH)),
    }),
    [],
  )

  const enqueue = useCallback(
    (shot) => setItems((current) => [...current, { id: nextId++, status: 'queued', ...shot }]),
    [],
  )

  function capture() {
    try {
      const shot = prepare(captureFromVideo(videoRef.current))
      // A failed check stops only this one shot; everything already queued
      // keeps processing behind the prompt.
      if (shot.quality.ok) enqueue(shot)
      else setPending(shot)
    } catch (err) {
      setCameraError(err.message)
    }
  }

  function keepPending() {
    enqueue(pending)
    setPending(null)
  }

  async function onFilesPicked(event) {
    const files = [...(event.target.files ?? [])]
    event.target.value = '' // let the same file be picked again after a retry
    for (const file of files) {
      try {
        // Picked files run the identical gate, but a poor one is queued anyway
        // with its warning attached. There is no "retake" available for a photo
        // someone else took last year, and refusing it outright would just lose
        // the record.
        enqueue(prepare(await fileToCanvas(file)))
      } catch (err) {
        setCameraError(err.message)
      }
    }
  }

  // --- background pipeline -------------------------------------------------
  // One at a time, on purpose: a stack of twenty receipts fired at once would
  // hit the vision API's rate limit and fail most of them.
  useEffect(() => {
    if (workingRef.current) return
    const next = items.find((item) => item.status === 'queued')
    if (!next) return

    workingRef.current = true
    const patch = (id, changes) =>
      setItems((current) => current.map((i) => (i.id === id ? { ...i, ...changes } : i)))

    ;(async () => {
      try {
        patch(next.id, { status: 'reading' })
        const { extraction } = await extractReceipt({
          image: next.dataUrl,
          itemKeys,
        })

        patch(next.id, { status: 'saving' })
        const result = await saveRecord({ vehicleId, extraction })

        // Drop the full-size image now it is uploaded; the thumbnail is enough
        // for the rest of the session and a long queue would otherwise sit in
        // memory as base64.
        patch(next.id, {
          status: 'saved',
          dataUrl: null,
          summary: describeExtraction(extraction),
        })
        onSaved?.({ extraction, ...result })
      } catch (err) {
        patch(next.id, { status: 'failed', error: err.message, dataUrl: next.dataUrl })
      } finally {
        workingRef.current = false
        // Nudge the effect to look for the next queued item.
        setItems((current) => [...current])
      }
    })()
  }, [items, itemKeys, vehicleId, onSaved])

  const retry = (id) =>
    setItems((current) =>
      current.map((i) => (i.id === id ? { ...i, status: 'queued', error: null } : i)),
    )

  const remove = (id) => setItems((current) => current.filter((i) => i.id !== id))

  return (
    <div className="flex flex-col gap-4">
      <ErrorNote>{cameraError}</ErrorNote>

      {pending ? (
        <RetakePrompt
          shot={pending}
          onRetake={() => setPending(null)}
          onKeep={keepPending}
        />
      ) : cameraOn ? (
        <div className="overflow-hidden rounded-xl border border-line bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="aspect-[3/4] w-full object-cover"
          />
          <div className="flex items-center justify-between gap-3 bg-surface px-4 py-3">
            <Button variant="ghost" size="sm" onClick={stopCamera}>
              Done
            </Button>
            <Button size="lg" onClick={capture} className="px-8">
              <Camera size={18} aria-hidden="true" />
              Capture
            </Button>
            <span className="w-14 text-right text-sm text-muted tnum">
              {items.length > 0 ? `${items.length}` : ''}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {isCameraSupported() ? (
            <Button size="lg" onClick={openCamera} loading={starting} className="justify-center">
              <Camera size={18} aria-hidden="true" />
              {items.length > 0 ? 'Scan another' : 'Start scanning'}
            </Button>
          ) : null}

          <Button
            variant="secondary"
            size="lg"
            className="justify-center"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImageUp size={18} aria-hidden="true" />
            Upload photos instead
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            // On a phone without getUserMedia this still opens the camera.
            capture={isCameraSupported() ? undefined : 'environment'}
            className="sr-only"
            onChange={onFilesPicked}
          />
        </div>
      )}

      {items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <QueueRow key={item.id} item={item} onRetry={retry} onRemove={remove} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function RetakePrompt({ shot, onRetake, onKeep }) {
  return (
    <div className="overflow-hidden rounded-xl border border-warn/40 bg-surface">
      <img src={shot.thumb} alt="" className="aspect-[3/4] w-full object-cover" />
      <div className="flex flex-col gap-3 px-4 py-3">
        <p className="text-sm text-warn-text">{shot.quality.message}</p>
        <div className="flex gap-2">
          <Button onClick={onRetake} className="flex-1 justify-center">
            <RotateCcw size={16} aria-hidden="true" />
            Retake
          </Button>
          <Button variant="secondary" onClick={onKeep}>
            Use anyway
          </Button>
        </div>
      </div>
    </div>
  )
}

function QueueRow({ item, onRetry, onRemove }) {
  const failed = item.status === 'failed'
  const saved = item.status === 'saved'

  return (
    <li className="flex items-center gap-3 rounded-lg border border-line bg-surface p-2">
      <img
        src={item.thumb}
        alt=""
        className="h-12 w-12 shrink-0 rounded object-cover"
      />

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-sm font-medium',
            failed ? 'text-bad-text' : saved ? 'text-ok-text' : 'text-fg',
          )}
        >
          {STATUS_LABEL[item.status]}
        </p>
        <p className="truncate text-xs text-muted">
          {item.error || item.summary || (item.quality?.ok === false ? item.quality.message : '')}
        </p>
      </div>

      {saved ? (
        <Check size={18} aria-hidden="true" className="mr-1 shrink-0 text-ok" />
      ) : failed ? (
        <>
          <Button size="sm" variant="secondary" onClick={() => onRetry(item.id)}>
            Retry
          </Button>
          <Button size="icon" variant="ghost" aria-label="Discard" onClick={() => onRemove(item.id)}>
            <X size={16} aria-hidden="true" />
          </Button>
        </>
      ) : (
        <span
          aria-hidden="true"
          className="mr-2 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-accent"
        />
      )}
    </li>
  )
}

function describeExtraction(extraction) {
  const bits = []
  if (extraction.serviceDate) bits.push(extraction.serviceDate)
  if (extraction.mileage) bits.push(`${extraction.mileage.toLocaleString('en-US')} mi`)
  bits.push(`${extraction.lineItems.length} ${extraction.lineItems.length === 1 ? 'item' : 'items'}`)
  return bits.join(' · ')
}
