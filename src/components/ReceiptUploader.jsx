import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Check, ImageUp, Layers, RotateCcw, Trash2, X } from 'lucide-react'

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
import {
  deletePending,
  isPersistenceAvailable,
  listPending,
  savePending,
  updatePending,
} from '../lib/pendingQueue.js'
import { assignPage } from '../lib/receiptGrouping.js'
import { cn } from '../lib/cn.js'
import { Button } from './ui/Button.jsx'
import { ErrorNote } from './ui/States.jsx'

const STATUS_LABEL = {
  queued: 'Waiting',
  reading: 'Reading…',
  saving: 'Saving…',
  saved: 'Saved',
  failed: 'Failed',
  paused: 'Rate limited',
}

const newId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `p-${Date.now()}-${Math.random().toString(16).slice(2)}`)

/**
 * The scanning flow: capture, check, extract, save.
 *
 * Four things shape it.
 *
 * A bad photo is caught the moment it is taken, while the receipt is still in
 * front of you — a retake then costs nothing, an hour later it costs another
 * trip to the shoebox.
 *
 * Extraction runs in the background while you keep shooting, one page at a
 * time so a stack of twenty does not trip the vision API's rate limit.
 *
 * Captures are written to IndexedDB before extraction, so a failure, a reload
 * or a locked phone does not mean photographing the stack again.
 *
 * Consecutive pages of one invoice are stitched back together: only the first
 * page carries the date, odometer and shop name, and the rest inherit them.
 */
export function ReceiptUploader({ vehicleId, itemKeys, onSaved }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const fileInputRef = useRef(null)
  const workingRef = useRef(false)
  // The document being assembled, carried across pages of one invoice.
  const documentRef = useRef(null)
  const groupIdRef = useRef(null)

  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState(null)
  const [starting, setStarting] = useState(false)
  const [pending, setPending] = useState(null) // a capture that failed the check
  const [items, setItems] = useState([])
  const [restored, setRestored] = useState(0)
  const [durable, setDurable] = useState(true)
  const [pausedUntil, setPausedUntil] = useState(null)
  const [quotaNote, setQuotaNote] = useState(null)

  const stopCamera = useCallback(() => {
    stopStream(streamRef.current)
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraOn(false)
  }, [])

  // Releasing the camera when the component goes away matters: on a phone the
  // recording indicator stays lit otherwise.
  useEffect(() => stopCamera, [stopCamera])

  // Anything left over from a previous session — a batch that hit a quota, or a
  // tab that got discarded — comes back rather than needing a re-scan.
  useEffect(() => {
    let active = true
    ;(async () => {
      const available = await isPersistenceAvailable()
      if (!active) return
      setDurable(available)
      if (!available) return

      const rows = await listPending(vehicleId)
      if (!active || rows.length === 0) return
      setItems(rows.map((row) => ({ ...row, status: 'queued', error: null })))
      setRestored(rows.length)
    })()
    return () => {
      active = false
    }
  }, [vehicleId])

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
      id: newId(),
      vehicleId,
      dataUrl: canvasToDataUrl(canvas),
      thumb: canvasToThumbnail(canvas),
      quality: assessCapture(analysisPixels(canvas, ANALYSIS_WIDTH)),
      capturedAt: Date.now(),
    }),
    [vehicleId],
  )

  const enqueue = useCallback(async (shot) => {
    // Persist first, queue second: a capture that never reaches storage is one
    // a crash would lose.
    await savePending({ ...shot, status: 'queued' })
    setItems((current) => [...current, { ...shot, status: 'queued' }])
  }, [])

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
        await enqueue(prepare(await fileToCanvas(file)))
      } catch (err) {
        setCameraError(err.message)
      }
    }
  }

  // --- background pipeline -------------------------------------------------
  // One page at a time, on purpose: a stack of twenty receipts fired at once
  // would hit the vision API's rate limit and fail most of them.
  useEffect(() => {
    if (workingRef.current) return
    if (pausedUntil && Date.now() < pausedUntil) return

    const next = items.find((item) => item.status === 'queued')
    if (!next) return

    workingRef.current = true
    const patch = (id, changes) =>
      setItems((current) => current.map((i) => (i.id === id ? { ...i, ...changes } : i)))

    ;(async () => {
      try {
        patch(next.id, { status: 'reading' })
        const { extraction } = await extractReceipt({ image: next.dataUrl, itemKeys })

        // Stitch this page onto the document in progress, or start a new one.
        const { isNewDocument, page, document } = assignPage(documentRef.current, extraction)
        documentRef.current = document
        if (isNewDocument) groupIdRef.current = newId()

        patch(next.id, { status: 'saving' })
        const result = await saveRecord({
          vehicleId,
          extraction: { ...page, receiptGroup: groupIdRef.current },
        })

        // Uploaded and stored — release both the local copy and the full-size
        // image, keeping only the thumbnail for the rest of the session.
        await deletePending(next.id)
        patch(next.id, {
          status: 'saved',
          dataUrl: null,
          continuation: !isNewDocument,
          summary: describePage(page, isNewDocument),
        })
        onSaved?.({ extraction: page, ...result })
      } catch (err) {
        if (err.status === 429) {
          // Not a failure of this page — the API is asking us to slow down. Put
          // it back in the queue and wait, so a long batch finishes late rather
          // than half-done.
          const daily = err.quotaScope === 'daily'
          const wait = daily ? null : (err.retryAfter ?? 60)
          await updatePending(next.id, { status: 'queued' })
          patch(next.id, { status: daily ? 'failed' : 'paused', error: err.message })
          setQuotaNote({ daily, message: err.message, until: wait ? Date.now() + wait * 1000 : null })
          if (wait) setPausedUntil(Date.now() + wait * 1000)
        } else {
          await updatePending(next.id, { status: 'failed', error: err.message })
          patch(next.id, { status: 'failed', error: err.message, dataUrl: next.dataUrl })
        }
      } finally {
        workingRef.current = false
        // Nudge the effect to look for the next queued item.
        setItems((current) => [...current])
      }
    })()
  }, [items, itemKeys, vehicleId, onSaved, pausedUntil])

  // While paused, wait out the delay the API asked for, then let the pipeline
  // pick the queue back up. A already-elapsed deadline still goes through the
  // timer rather than setting state during the effect body.
  useEffect(() => {
    if (!pausedUntil) return undefined
    const timer = setTimeout(
      () => {
        setPausedUntil(null)
        setQuotaNote(null)
        setItems((current) =>
          current.map((i) => (i.status === 'paused' ? { ...i, status: 'queued' } : i)),
        )
      },
      Math.max(0, pausedUntil - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [pausedUntil])

  const retry = (id) =>
    setItems((current) =>
      current.map((i) => (i.id === id ? { ...i, status: 'queued', error: null } : i)),
    )

  const remove = async (id) => {
    await deletePending(id)
    setItems((current) => current.filter((i) => i.id !== id))
  }

  const waiting = items.filter((i) => i.status !== 'saved').length

  return (
    <div className="flex flex-col gap-4">
      <ErrorNote>{cameraError}</ErrorNote>

      {restored > 0 ? (
        <p className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-muted">
          Picked up {restored} {restored === 1 ? 'page' : 'pages'} from last time — carrying on where
          you left off.
        </p>
      ) : null}

      {!durable ? (
        <p className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn-text">
          This browser will not let the app store pages offline, so a reload will lose anything not
          yet read. Scanning still works.
        </p>
      ) : null}

      {quotaNote ? (
        <p
          role="status"
          className={cn(
            'rounded-lg border px-3 py-2 text-sm',
            quotaNote.daily
              ? 'border-bad/30 bg-bad-soft text-bad-text'
              : 'border-warn/30 bg-warn-soft text-warn-text',
          )}
        >
          {quotaNote.message}
          {quotaNote.daily
            ? ' Your pages are saved on this device — come back and they will pick up where they stopped.'
            : ' Holding the queue for a moment.'}
        </p>
      ) : null}

      {pending ? (
        <RetakePrompt shot={pending} onRetake={() => setPending(null)} onKeep={keepPending} />
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
              {waiting > 0 ? waiting : ''}
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
  const paused = item.status === 'paused'

  return (
    <li className="flex items-center gap-3 rounded-lg border border-line bg-surface p-2">
      <img src={item.thumb} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'flex items-center gap-1.5 text-sm font-medium',
            failed ? 'text-bad-text' : saved ? 'text-ok-text' : paused ? 'text-warn-text' : 'text-fg',
          )}
        >
          {STATUS_LABEL[item.status]}
          {item.continuation ? (
            <span
              title="Continuation of the previous page"
              className="inline-flex items-center gap-1 rounded border border-line px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted"
            >
              <Layers size={10} aria-hidden="true" />
              same visit
            </span>
          ) : null}
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
            <Trash2 size={16} aria-hidden="true" />
          </Button>
        </>
      ) : paused ? (
        <Button size="icon" variant="ghost" aria-label="Discard" onClick={() => onRemove(item.id)}>
          <X size={16} aria-hidden="true" />
        </Button>
      ) : (
        <span
          aria-hidden="true"
          className="mr-2 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-accent"
        />
      )}
    </li>
  )
}

function describePage(page, isNewDocument) {
  const bits = []
  if (!isNewDocument) bits.push('continued')
  if (page.serviceDate) bits.push(page.serviceDate)
  if (page.mileage) bits.push(`${page.mileage.toLocaleString('en-US')} mi`)
  bits.push(`${page.lineItems.length} ${page.lineItems.length === 1 ? 'item' : 'items'}`)
  return bits.join(' · ')
}
