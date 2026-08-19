/**
 * How-to demos for exercises and yoga poses.
 *
 * A name means nothing until you have seen the movement, so each exercise
 * carries a couple of labelled photos, a few written steps, and a link to a
 * video for when the stills are not enough. The photos and instructions are
 * the public-domain free-exercise-db; the yoga illustrations are the open
 * yoga-api; the video is a YouTube search, which needs no key and never runs
 * out. Bundled at /demos.json and fetched once.
 */
export interface Demo {
  photos: string[]
  steps: string[]
  video: string
}

let cache: Record<string, Demo> | null = null
let inflight: Promise<Record<string, Demo>> | null = null

export async function loadDemos(): Promise<Record<string, Demo>> {
  if (cache) return cache
  if (inflight) return inflight
  inflight = fetch('/demos.json')
    .then((r) => (r.ok ? r.json() : {}))
    .then((d: Record<string, Demo>) => {
      cache = d
      return d
    })
    .catch(() => ({}))
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** The demo for a name, or a video-only fallback so there is always something. */
export function demoFor(all: Record<string, Demo> | null, name: string): Demo | null {
  if (!all) return null
  if (all[name]) return all[name]
  // A swapped-in or renamed exercise still gets a video from its bare name.
  const q = encodeURIComponent(`how to ${name.replace(/—.*|\(.*\)/g, '').trim()} proper form`)
  return { photos: [], steps: [], video: `https://www.youtube.com/results?search_query=${q}` }
}
