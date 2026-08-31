import { Sheet } from './ui'
import type { Measurement } from '../db/db'

/**
 * Where to put the tape, drawn rather than described.
 *
 * The exercise demos lean on the free-exercise-db photos, but nothing
 * equivalent exists for tape placement that is not somebody's copyright, and a
 * photograph is the wrong medium anyway: what matters here is a single line on
 * a body, and a drawing states that without the noise of a real torso. So each
 * measurement gets a figure with its band on it, drawn as an ellipse because
 * that is what a circumference looks like from the front.
 *
 * The wording matters more than it looks. Two of these feed the Navy body-fat
 * estimate, which was calibrated on measurements taken a particular way — the
 * waist at the navel, the neck below the larynx — so the instructions are not
 * general advice but the specific protocol that formula assumes. Measure them
 * somewhere else and the number it returns is answering a different question.
 *
 * The repeated line across all six is "same spot, same tension, every time".
 * Placement drift and tension drift are each worth a centimetre or more, which
 * is a month of real progress at his rate; a consistent technique that is
 * slightly wrong still reads the trend correctly, while an accurate one that
 * moves around does not.
 */

type Key = keyof Measurement

interface Guide {
  /** The tape band: centre and radii within the 120x220 figure. */
  band: { cx: number; cy: number; rx: number; ry: number }
  where: string
  steps: string[]
  /** Why this one is worth getting right, when it feeds something. */
  note?: string
}

const GUIDES: Partial<Record<Key, Guide>> = {
  waist: {
    band: { cx: 60, cy: 100, rx: 21, ry: 6 },
    where: 'Around the navel',
    steps: [
      'Tape level with your belly button, parallel to the floor.',
      'Arms relaxed at your sides — not holding the tape up.',
      'Breathe out normally and measure at the end of that breath.',
      'Do not suck in, and do not push out.',
    ],
    note: 'This one feeds the body-fat estimate, which was calibrated at the navel. Measuring at your narrowest point instead will read leaner than you are.',
  },
  neck: {
    band: { cx: 60, cy: 40, rx: 10.5, ry: 4 },
    where: 'Just below the Adam’s apple',
    steps: [
      'Tape below the larynx, sloping very slightly downward at the front.',
      'Shoulders down, looking straight ahead — not tucking your chin.',
      'Snug, but do not compress the skin.',
    ],
    note: 'Paired with the waist in the body-fat estimate. An error here moves that number as much as the waist does.',
  },
  chest: {
    band: { cx: 60, cy: 74, rx: 25, ry: 7 },
    where: 'Across the nipples',
    steps: [
      'Tape at nipple level, level all the way round.',
      'Arms down and relaxed once the tape is in place.',
      'Measure at the end of a normal breath out — not a full chest.',
    ],
  },
  hips: {
    band: { cx: 60, cy: 124, rx: 26, ry: 7 },
    where: 'The widest part of the buttocks',
    steps: [
      'Feet together, standing straight.',
      'Find the widest point — usually a hand’s width below the hip bones.',
      'Tape parallel to the floor. Check it in a mirror if you can.',
    ],
  },
  arm: {
    band: { cx: 28, cy: 82, rx: 7, ry: 3.5 },
    where: 'Mid-upper arm, relaxed',
    steps: [
      'Halfway between the point of the shoulder and the elbow.',
      'Arm hanging relaxed at your side — not flexed.',
      'Same arm every time. Write down which one.',
    ],
    note: 'Relaxed and flexed differ by a couple of centimetres. Either is fine to track; mixing them is not.',
  },
  thigh: {
    band: { cx: 47, cy: 154, rx: 11, ry: 4.5 },
    where: 'Mid-thigh',
    steps: [
      'Halfway between the crease of your hip and the top of your kneecap.',
      'Stand with weight even on both feet.',
      'Same leg every time.',
    ],
  },
}

/** A plain front-on figure. Deliberately faceless and unshaded — it is a diagram. */
function Figure({ band }: { band: Guide['band'] }) {
  return (
    <svg
      viewBox="0 0 120 220"
      width="100%"
      height="230"
      role="img"
      aria-label="Where to place the tape"
      style={{ display: 'block' }}
    >
      <g
        fill="none"
        stroke="var(--text-muted)"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* head and neck */}
        <circle cx={60} cy={24} r={11} />
        <path d="M53,34 L53,42 M67,34 L67,42" />
        {/* shoulders and torso, tapering at the waist and out again at the hips */}
        <path d="M53,42 C40,44 34,50 32,58 L30,66" />
        <path d="M67,42 C80,44 86,50 88,58 L90,66" />
        <path d="M32,58 C36,76 38,90 40,100 C41,112 38,120 36,130" />
        <path d="M88,58 C84,76 82,90 80,100 C79,112 82,120 84,130" />
        {/* hips */}
        <path d="M36,130 C44,136 76,136 84,130" />
        {/* arms */}
        <path d="M30,66 C27,80 26,94 27,106" />
        <path d="M90,66 C93,80 94,94 93,106" />
        <path d="M27,106 C26,114 26,120 27,126" />
        <path d="M93,106 C94,114 94,120 93,126" />
        {/* legs */}
        <path d="M44,134 C43,150 42,168 42,190" />
        <path d="M58,136 C58,152 57,170 56,190" />
        <path d="M62,136 C62,152 63,170 64,190" />
        <path d="M76,134 C77,150 78,168 78,190" />
      </g>

      {/* The tape itself: a dashed ellipse, because a band around a body reads
          as one from the front. Drawn over the figure so it is unmistakably on
          top of it rather than part of the outline. */}
      <ellipse
        cx={band.cx}
        cy={band.cy}
        rx={band.rx}
        ry={band.ry}
        fill="none"
        stroke="var(--series-2)"
        strokeWidth={2.6}
        strokeDasharray="5 3"
      />
      <ellipse cx={band.cx} cy={band.cy} rx={band.rx} ry={band.ry} fill="var(--series-2)" opacity={0.12} />
    </svg>
  )
}

export default function MeasureGuide({ which, onClose }: { which: Key; onClose: () => void }) {
  const g = GUIDES[which]
  if (!g) return null
  const title = String(which).charAt(0).toUpperCase() + String(which).slice(1)

  return (
    <Sheet title={`Measuring: ${title}`} onClose={onClose}>
      <div className="card tight">
        <Figure band={g.band} />
        <div className="row between small" style={{ paddingTop: 4 }}>
          <span className="muted">Tape goes</span>
          <span>{g.where}</span>
        </div>
      </div>

      {/* Same list shape the exercise demos use, so the two read as siblings. */}
      <ol className="stack tight" style={{ paddingLeft: 18, margin: 0 }}>
        {g.steps.map((s, i) => (
          <li key={i} className="small">
            {s}
          </li>
        ))}
      </ol>

      {g.note && <div className="note-block tiny">{g.note}</div>}

      <div className="note-block tiny">
        <strong>The rule that matters most:</strong> same spot, same tension, every time. Tighten
        until the tape just barely slides when you tug it sideways, then read it. Measure in the
        morning, before eating, after the toilet — the same conditions as your weigh-in. Take three
        readings and keep the middle one.
      </div>
    </Sheet>
  )
}
