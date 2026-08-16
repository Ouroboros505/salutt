import { useEffect, useRef, useState } from 'react'
import { Icon, Sheet } from './ui'

/**
 * Chrome on Android ships a native BarcodeDetector, so scanning needs no
 * library at all. Everywhere else this degrades to typing the number in.
 */
interface DetectedBarcode {
  rawValue: string
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf']

export default function BarcodeScanner({
  onDetect,
  onClose,
}: {
  onDetect: (code: string) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState('')

  const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  const supported = typeof Ctor === 'function' && !!navigator.mediaDevices?.getUserMedia

  useEffect(() => {
    if (!supported) return
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false
    const detector = new Ctor!({ formats: FORMATS })

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        })
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        tick()
      } catch (e) {
        const name = (e as DOMException)?.name
        setError(
          name === 'NotAllowedError'
            ? 'Camera permission denied.'
            : location.protocol !== 'https:' && location.hostname !== 'localhost'
              ? 'The camera needs HTTPS (or localhost). Type the barcode instead.'
              : 'Could not start the camera.',
        )
      }
    }

    const tick = async () => {
      const video = videoRef.current
      if (stopped || !video || video.readyState < 2) {
        raf = requestAnimationFrame(tick)
        return
      }
      try {
        const found = await detector.detect(video)
        if (found.length > 0 && found[0].rawValue) {
          navigator.vibrate?.(40)
          onDetect(found[0].rawValue)
          return
        }
      } catch {
        // A transient detect() failure is not worth tearing the camera down.
      }
      raf = requestAnimationFrame(tick)
    }

    void start()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [supported, Ctor, onDetect])

  return (
    <Sheet title="Scan barcode" onClose={onClose}>
      {supported && !error && (
        <div
          style={{
            position: 'relative',
            borderRadius: 'var(--radius)',
            overflow: 'hidden',
            background: '#000',
            aspectRatio: '4 / 3',
          }}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: '28% 12%',
              border: '2px solid rgba(255,255,255,0.85)',
              borderRadius: 10,
              boxShadow: '0 0 0 100vmax rgba(0,0,0,0.35)',
            }}
          />
        </div>
      )}

      {error && <div className="tiny" style={{ color: 'var(--critical)' }}>{error}</div>}
      {!supported && !error && (
        <div className="tiny muted">
          This browser has no barcode detector. Type the number under the barcode instead.
        </div>
      )}

      <div className="field">
        <label>Barcode number</label>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="grow"
            inputMode="numeric"
            value={manual}
            onChange={(e) => setManual(e.target.value.replace(/\D/g, ''))}
            placeholder="8410000000000"
          />
          <button className="btn primary" disabled={manual.length < 6} onClick={() => onDetect(manual)}>
            <Icon.check />
          </button>
        </div>
      </div>
    </Sheet>
  )
}
