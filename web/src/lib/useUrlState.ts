import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { forwardReturnState } from './navigationContext'

/*
 * Page state in the URL (L-0.6): filters, search, the selected item, the open
 * tab and expanded sections live in the query string, so a copied link, a
 * reload and browser Back all restore the same view.
 *
 * - Each key has a typed parser. A missing, malformed or unknown value parses
 *   to the default; parsing never throws.
 * - Defaults are left out of the URL, so a page with nothing chosen keeps a
 *   clean address and existing deep links stay valid.
 * - Choosing a filter or a tab pushes a history entry (Back undoes it);
 *   typing in a search box replaces the current one.
 * - Keys the page does not own (`cohort_id`, `return_to`, a notification's
 *   anchor) are kept, and so is the record's return context in router state.
 *
 * Only view state goes here. Never put drafts, tokens, emails or other
 * personal details in the URL: it is copied, logged and shared.
 */

export interface UrlParser<T> {
  /** Reads a raw query value (null when absent). Must not throw. */
  parse: (raw: string | null) => T
  /** The query value, or null to leave the key out (the default). */
  serialize: (value: T) => string | null
}

export type History = 'push' | 'replace'

const POSITIVE_ID = /^[1-9]\d{0,15}$/

function positiveId(raw: string | null | undefined): number | null {
  if (!raw || !POSITIVE_ID.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : null
}

export const urlParsers = {
  /** One of a fixed set of values; anything else is the fallback. */
  oneOf<T extends string>(values: readonly T[], fallback: T): UrlParser<T> {
    return {
      parse: (raw) => (raw !== null && (values as readonly string[]).includes(raw) ? raw as T : fallback),
      serialize: (value) => (value === fallback || !(values as readonly string[]).includes(value) ? null : value),
    }
  },
  /** Free text such as a search box, capped in length. Empty is the default. */
  text(maxLength = 100): UrlParser<string> {
    return {
      parse: (raw) => (raw || '').slice(0, maxLength),
      serialize: (value) => {
        const capped = value.slice(0, maxLength)
        return capped.trim() ? capped : null
      },
    }
  },
  /** A record id: a positive integer, or null. */
  id(): UrlParser<number | null> {
    return { parse: positiveId, serialize: (value) => (value && Number.isSafeInteger(value) && value > 0 ? String(value) : null) }
  },
  /** A whole number clamped to [min, max]; out-of-range values clamp, junk is the fallback. */
  int(min: number, max: number, fallback: number): UrlParser<number> {
    return {
      parse: (raw) => {
        if (!raw || !/^-?\d{1,6}$/.test(raw)) return fallback
        return Math.min(max, Math.max(min, Number(raw)))
      },
      serialize: (value) => (value === fallback || !Number.isInteger(value) ? null : String(Math.min(max, Math.max(min, value)))),
    }
  },
  /** A set of ids, comma-separated, deduplicated and sorted, at most `max` of them. */
  ids(max = 50): UrlParser<number[]> {
    return {
      parse: (raw) => {
        if (!raw) return []
        const ids = new Set<number>()
        for (const part of raw.split(',', max * 4 + 20)) {
          const id = positiveId(part.trim())
          if (id) ids.add(id)
          if (ids.size >= max) break
        }
        return Array.from(ids).sort((a, b) => a - b)
      },
      serialize: (value) => {
        const ids = Array.from(new Set(value.filter((id) => Number.isSafeInteger(id) && id > 0))).sort((a, b) => a - b).slice(0, max)
        return ids.length ? ids.join(',') : null
      },
    }
  },
  /** Pairs of id → whole number ("12:3,15:2"), each value clamped; pairs equal to `fallback` are left out. */
  idMap(min: number, max: number, fallback: number, maxEntries = 50): UrlParser<Record<number, number>> {
    return {
      parse: (raw) => {
        const result: Record<number, number> = {}
        if (!raw) return result
        let count = 0
        for (const part of raw.split(',', maxEntries * 4 + 20)) {
          const [key, value] = part.split(':')
          const id = positiveId(key?.trim())
          if (!id || !value || !/^\d{1,6}$/.test(value.trim())) continue
          result[id] = Math.min(max, Math.max(min, Number(value)))
          if (++count >= maxEntries) break
        }
        return result
      },
      serialize: (value) => {
        const pairs = Object.entries(value)
          .map(([key, entry]) => [positiveId(key), entry] as const)
          .filter((pair): pair is readonly [number, number] => pair[0] !== null && Number.isInteger(pair[1]) && pair[1] !== fallback)
          .sort((a, b) => a[0] - b[0])
          .slice(0, maxEntries)
          .map(([key, entry]) => `${key}:${Math.min(max, Math.max(min, entry))}`)
        return pairs.length ? pairs.join(',') : null
      },
    }
  },
  /** On when the key is "1"; off (the default) otherwise. */
  flag(): UrlParser<boolean> {
    return { parse: (raw) => raw === '1', serialize: (value) => (value ? '1' : null) }
  },
}

/*
 * The last write that the router may not have rendered yet, shared by every
 * hook instance (a page's filters and its search box are separate hooks). It
 * applies only while the location it was made from (same history entry key)
 * is still the one rendered; once the router moves on, it is ignored.
 */
const pendingWrite: { current: { key: string; pathname: string; search: string } | null } = { current: null }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Schema = Record<string, UrlParser<any>>
export type UrlValues<S extends Schema> = { [K in keyof S]: S[K] extends UrlParser<infer T> ? T : never }
export interface SetUrlStateOptions {
  history?: History
}

/** Applies a patch to a query string through the schema's serializers. Exported for tests. */
export function applyUrlPatch<S extends Schema>(search: string, schema: S, patch: Partial<UrlValues<S>>) {
  const next = new URLSearchParams(search)
  for (const key of Object.keys(patch) as Array<keyof S & string>) {
    const parser = schema[key]
    if (!parser) continue
    const serialized = parser.serialize(patch[key])
    next.delete(key)
    if (serialized !== null) next.set(key, serialized)
  }
  const query = next.toString()
  return query ? `?${query}` : ''
}

/** Reads every key of the schema from a query string. */
export function readUrlState<S extends Schema>(search: string, schema: S): UrlValues<S> {
  const params = new URLSearchParams(search)
  const values = {} as Record<string, unknown>
  for (const key of Object.keys(schema)) values[key] = schema[key].parse(params.get(key))
  return values as UrlValues<S>
}

/**
 * Typed state for a set of query keys. Returns the parsed values and a setter
 * that takes a patch: `set({ filter: 'redo', submission: null })`. Pushes by
 * default; pass `{ history: 'replace' }` for typing. Several calls in one
 * event build on each other instead of overwriting.
 *
 * Define the schema outside the component, or memoize it: a parser that
 * depends on runtime data (the tabs this viewer may see) is fine as long as
 * it is stable between renders.
 */
export function useUrlState<S extends Schema>(schema: S): [UrlValues<S>, (patch: Partial<UrlValues<S>>, options?: SetUrlStateOptions) => void] {
  const location = useLocation()
  const navigate = useNavigate()
  const values = useMemo(() => readUrlState(location.search, schema), [location.search, schema])
  const latest = useRef({ location, schema })
  latest.current = { location, schema }
  // The router has rendered another entry, so the pending write has landed or been left behind (Back).
  if (pendingWrite.current && pendingWrite.current.key !== location.key) pendingWrite.current = null

  const set = useCallback((patch: Partial<UrlValues<S>>, options: SetUrlStateOptions = {}) => {
    const { location: current, schema: currentSchema } = latest.current
    // A write made before the router re-renders (a click that sets two keys, or typing straight
    // after choosing a filter, from another hook on the page) builds on the pending query.
    const pending = pendingWrite.current
    const base = pending && pending.key === current.key && pending.pathname === current.pathname ? pending.search : current.search
    const search = applyUrlPatch(base, currentSchema, patch)
    if (search === base && search === current.search) return
    pendingWrite.current = { key: current.key, pathname: current.pathname, search }
    navigate(
      { pathname: current.pathname, search, hash: current.hash },
      {
        replace: options.history === 'replace',
        preventScrollReset: true,
        // A filter or tab change stays on this page, so the record's Back link keeps its origin.
        state: forwardReturnState(current.state),
      },
    )
  }, [navigate])

  return [values, set]
}

/** One key: `const [filter, setFilter] = useUrlParam('filter', FILTER)`. */
export function useUrlParam<T>(key: string, parser: UrlParser<T>, defaultHistory: History = 'push'): [T, (value: T, options?: SetUrlStateOptions) => void] {
  const schema = useMemo(() => ({ [key]: parser }), [key, parser])
  const [values, set] = useUrlState(schema)
  const setValue = useCallback((value: T, options?: SetUrlStateOptions) => set({ [key]: value } as never, { history: options?.history ?? defaultHistory }), [key, set, defaultHistory])
  return [values[key] as T, setValue]
}

/**
 * A search box backed by a query key. The box keeps its own state so fast
 * typing never waits on the router, and the URL mirrors it with `replace`
 * (typing never adds history entries). When the URL changes from outside
 * (Back, a link), the box follows.
 */
export function useUrlSearch(key = 'q', maxLength = 100): [string, (value: string) => void] {
  const parser = useMemo(() => urlParsers.text(maxLength), [maxLength])
  const [fromUrl, setUrl] = useUrlParam(key, parser, 'replace')
  const [value, setValue] = useState(fromUrl)
  // Values this box wrote that the router has not reported back yet, oldest first.
  const written = useRef<string[]>([])
  useEffect(() => {
    // The echo of our own write (possibly a stale one while typing fast) is ignored; anything else is followed.
    const echo = written.current.indexOf(fromUrl)
    if (echo >= 0) {
      written.current.splice(0, echo + 1)
      return
    }
    written.current = []
    setValue(fromUrl)
  }, [fromUrl])
  const update = useCallback((next: string) => {
    const capped = next.slice(0, maxLength)
    setValue(capped)
    written.current.push(parser.parse(parser.serialize(capped)))
    setUrl(capped, { history: 'replace' })
  }, [maxLength, parser, setUrl])
  return [value, update]
}
