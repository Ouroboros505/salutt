import { useEffect, useState } from 'react'
import { loadDemos, demoFor, type Demo } from '../lib/demos'
import { Icon, Sheet } from './ui'

/**
 * A quick look at how a movement is done: photos, steps, and a video.
 *
 * Opened from the "?" on an exercise. The photos and steps show instantly if
 * they are cached; the video is a tap away for the coaching cues a still frame
 * cannot give — which is the thing worth leaving the app for.
 */
export default function DemoSheet({ name, onClose }: { name: string; onClose: () => void }) {
  const [demo, setDemo] = useState<Demo | null>(null)
  useEffect(() => {
    void loadDemos().then((all) => setDemo(demoFor(all, name)))
  }, [name])

  return (
    <Sheet title={name.replace(/—.*/, '').trim()} onClose={onClose}>
      {demo === null ? (
        <div className="empty">Loading…</div>
      ) : (
        <>
          {demo.photos.length > 0 && (
            <div className="scroll-x" style={{ gap: 8 }}>
              {demo.photos.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt={`${name} — ${i === 0 ? 'start' : 'finish'} position`}
                  loading="lazy"
                  style={{ height: 180, borderRadius: 10, flex: 'none', background: 'var(--plane)' }}
                />
              ))}
            </div>
          )}
          {demo.photos.length === 0 && (
            <div className="small muted">No photo for this one — the video shows it best.</div>
          )}

          {demo.steps.length > 0 && (
            <ol className="stack tight" style={{ paddingLeft: 18, margin: 0 }}>
              {demo.steps.map((s, i) => (
                <li key={i} className="small">
                  {s}
                </li>
              ))}
            </ol>
          )}

          <a className="btn primary block" href={demo.video} target="_blank" rel="noreferrer">
            <Icon.play /> Watch a video
          </a>
          <div className="tiny muted" style={{ textAlign: 'center' }}>
            Opens YouTube — for the cues a photo cannot give.
          </div>
        </>
      )}
    </Sheet>
  )
}
