import { useEffect, useState } from 'react'
import { loadDemos, demoFor, type Demo } from '../lib/demos'
import { Icon, Sheet } from './ui'

/**
 * How a movement is done, without leaving the app.
 *
 * Static photos and written steps from the public-domain free-exercise-db show
 * the positions instantly. For the motion — the thing a name and a still frame
 * cannot give — a YouTube player is embedded in place and plays the top
 * "how to" result. Animated gifs were the obvious idea and turned out to be a
 * trap: every free gif dataset is scraped from one paid source (gymvisual),
 * so shipping them would be someone else's copyright in your app. A YouTube
 * embed is the demonstration YouTube itself licenses for embedding, played
 * natively rather than linked away to.
 */
export default function DemoSheet({ name, onClose }: { name: string; onClose: () => void }) {
  const [demo, setDemo] = useState<Demo | null>(null)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    void loadDemos().then((all) => setDemo(demoFor(all, name)))
  }, [name])

  const clean = name.replace(/—.*|\(.*\)/g, '').trim()
  const query = encodeURIComponent(`how to ${clean} proper form technique`)
  const search = `https://www.youtube.com/results?search_query=${query}`
  // A specific, embed-checked id plays; a search embed does not (Error 153),
  // so without an id there is nothing to play in-app and only the link remains.
  // A concrete video id, told which origin is embedding it — the Playback ID
  // error is YouTube declining to play when it cannot confirm that origin.
  const origin = typeof location !== 'undefined' ? location.origin : ''
  const embed = demo?.videoId
    ? `https://www.youtube-nocookie.com/embed/${demo.videoId}?rel=0&playsinline=1&origin=${encodeURIComponent(origin)}`
    : null

  return (
    <Sheet title={clean} onClose={onClose}>
      {/* The video leads: it is what he came for. */}
      {playing && embed ? (
        <div style={{ position: 'relative', paddingTop: '56%', borderRadius: 10, overflow: 'hidden' }}>
          <iframe
            title={`${clean} demo`}
            src={`${embed}&autoplay=1`}
            allow="autoplay; encrypted-media; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
          />
        </div>
      ) : embed ? (
        <button
          className="btn primary block"
          onClick={() => setPlaying(true)}
          style={{ height: 44 }}
        >
          <Icon.play /> Play a demo video
        </button>
      ) : (
        <a className="btn primary block" href={search} target="_blank" rel="noreferrer">
          <Icon.play /> Watch on YouTube
        </a>
      )}

      {demo && demo.photos.length > 0 && (
        <>
          <div className="tiny muted">Positions</div>
          <div className="scroll-x" style={{ gap: 8 }}>
            {demo.photos.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`${clean} — ${i === 0 ? 'start' : 'finish'}`}
                loading="lazy"
                style={{ height: 170, borderRadius: 10, flex: 'none', background: 'var(--plane)' }}
              />
            ))}
          </div>
        </>
      )}

      {demo && demo.steps.length > 0 && (
        <ol className="stack tight" style={{ paddingLeft: 18, margin: 0 }}>
          {demo.steps.map((s, i) => (
            <li key={i} className="small">
              {s}
            </li>
          ))}
        </ol>
      )}

      <a className="tiny muted" href={search} target="_blank" rel="noreferrer" style={{ textAlign: 'center' }}>
        Not playing? Open on YouTube
      </a>
    </Sheet>
  )
}
