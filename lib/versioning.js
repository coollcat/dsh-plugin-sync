// Causal revision helpers. Wall-clock time is audit-only and never decides order.

import { hash } from './protocol.js'

export function zeroClock() {
  return {}
}

export function bump(clock, author, by = 1) {
  return { ...(clock ?? {}), [author]: (Object.hasOwn(clock ?? {}, author) ? clock[author] : 0) + by }
}

export function mergeClocks(...clocks) {
  const out = Object.create(null)
  for (const clock of clocks) {
    for (const [author, count] of Object.entries(clock ?? {})) {
      out[author] = Math.max(out[author] ?? 0, count)
    }
  }
  return out
}

// -1: a is before b; 1: a is after b; 0: equal; null: concurrent.
export function compareClocks(a, b) {
  const authors = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])
  let aGreater = false
  let bGreater = false
  for (const author of authors) {
    const av = (Object.hasOwn(a ?? {}, author) ? a[author] : 0)
    const bv = (Object.hasOwn(b ?? {}, author) ? b[author] : 0)
    if (av > bv) aGreater = true
    if (bv > av) bGreater = true
  }
  if (aGreater && bGreater) return null
  if (aGreater) return 1
  if (bGreater) return -1
  return 0
}

export function nextRevision(state, author, other = null) {
  const clock = bump(mergeClocks(state?.clock, other?.clock), author)
  return {
    number: Math.max(state?.number ?? 0, other?.number ?? 0) + 1,
    author,
    clock,
    parents: [...new Set([state?.hash, other?.hash].filter(Boolean))],
  }
}

export function revisionHash(revision) {
  return hash(revision)
}
