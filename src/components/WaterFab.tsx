import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Settings } from '../db/db'
import { todayISO } from '../lib/date'
import { addBottle, bottleMlOf, formatWater } from '../lib/water'

/**
 * A bottle counter that floats over the session sheet.
 *
 * He drinks during a workout and refills between sets, and logging that meant
 * leaving the session, tapping the Today tile, and coming back — a detour
 * that stops a habit dead. So the same counter rides along, only here: it is
 * the one screen where the detour is long enough to matter, and a floating
 * control anywhere else would be clutter.
 *
 * It can be dragged, because a fixed spot will sit on top of something on
 * some phone. The hard part is telling a drag from a tap. A press that moves
 * further than a few pixels is a drag and must not count as a bottle — the
 * failure mode otherwise is logging water every time it gets nudged out of
 * the way, which is exactly the kind of silent error that poisons a tally.
 * Pointer events with capture make that decision on the same element, so it
 * holds whether the pointer is a finger or a mouse.
 *
 * Where it was left is remembered per device. That is a preference about the
 * screen, not data about him, so it lives in localStorage rather than sync.
 */
const POS_KEY = 'salutt.waterfab.pos'
const DRAG_THRESHOLD_PX = 8
const SIZE = 56

type Pos = { x: number; y: number }

function loadPos(): Pos | null {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Pos
    return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null
  } catch {
    return null
  }
}

/** Keep it on screen whatever the viewport is now. */
function clamp(p: Pos): Pos {
  const margin = 8
  return {
    x: Math.min(Math.max(margin, p.x), window.innerWidth - SIZE - margin),
    y: Math.min(Math.max(margin, p.y), window.innerHeight - SIZE - margin),
  }
}

export default function WaterFab({ settings }: { settings: Settings }) {
  const date = todayISO()
  const row = useLiveQuery(() => db.water.where('date').equals(date).first(), [date])
  const bottles = row?.bottles ?? 0
  const bottleMl = bottleMlOf(settings)
  const shown = formatWater(bottles, bottleMl)

  // Bottom-right by default, above the sheet's own buttons.
  const [pos, setPos] = useState<Pos>(() =>
    clamp(loadPos() ?? { x: window.innerWidth - SIZE - 16, y: window.innerHeight - SIZE - 120 }),
  )
  const [bump, setBump] = useState(false)

  // Everything about the press in progress. Refs, not state: nothing here
  // should cause a render until the pointer actually moves the button.
  const press = useRef<{ startX: number; startY: number; originX: number; originY: number; dragged: boolean } | null>(
    null,
  )

  useEffect(() => {
    const onResize = () => setPos((p) => clamp(p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    press.current = { startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y, dragged: false }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = press.current
    if (!p) return
    const dx = e.clientX - p.startX
    const dy = e.clientY - p.startY
    // Below the threshold a finger's natural wobble is still a tap.
    if (!p.dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
    p.dragged = true
    setPos(clamp({ x: p.originX + dx, y: p.originY + dy }))
  }

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = press.current
    press.current = null
    if (!p) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (p.dragged) {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(pos))
      } catch {
        /* a preference; losing it costs one drag */
      }
      return
    }
    void addBottle(date, 1)
    setBump(true)
    window.setTimeout(() => setBump(false), 220)
  }

  return (
    <button
      type="button"
      className={`waterfab${bump ? ' bump' : ''}`}
      style={{ left: pos.x, top: pos.y, width: SIZE, height: SIZE }}
      aria-label={`Add a bottle of water. ${bottles} so far today`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (press.current = null)}
      // The click is handled on pointer-up so a drag can veto it; a synthetic
      // click after would count the bottle twice.
      onClick={(e) => e.preventDefault()}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          d="M12 2.5c-3.2 4.3-6.5 8-6.5 12a6.5 6.5 0 0 0 13 0c0-4-3.3-7.7-6.5-12z"
          fill="currentColor"
          opacity="0.95"
        />
      </svg>
      <span className="waterfab-val num">
        {shown.value}
        <small>{shown.unit}</small>
      </span>
    </button>
  )
}
