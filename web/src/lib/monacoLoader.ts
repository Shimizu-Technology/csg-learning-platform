import { loader } from '@monaco-editor/react'

export const MONACO_VS_PATH = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs'
export const MONACO_LOAD_TIMEOUT_MS = 6000
export const PHONE_CODE_EDITOR_QUERY = '(max-width: 639px)'

export type MonacoLoadStatus = 'idle' | 'loading' | 'ready' | 'failed'
type MonacoLike = {
  editor: Record<string, unknown>
}

type AmdRequire = {
  (deps: string[], onSuccess: (loaded: unknown) => void, onError: (error: unknown) => void): void
  config: (options: { paths: { vs: string } }) => void
}

type MonacoWindow = Window & {
  monaco?: MonacoLike
  require?: AmdRequire
}

let status: MonacoLoadStatus = 'idle'
let monacoInstance: MonacoLike | null = null
let loadPromise: Promise<MonacoLike> | null = null
let activeTimeoutId: number | null = null
let attemptId = 0

function isValidMonaco(value: unknown): value is MonacoLike {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'editor' in value &&
      typeof (value as MonacoLike).editor === 'object' &&
      (value as MonacoLike).editor !== null,
  )
}

function getMonacoWindow(): MonacoWindow {
  return window as unknown as MonacoWindow
}

function getWindowMonaco(): MonacoLike | null {
  if (typeof window === 'undefined') return null
  const candidate = getMonacoWindow().monaco
  return isValidMonaco(candidate) ? candidate : null
}

function registerWithReactLoader(monaco: MonacoLike) {
  if (typeof loader?.config === 'function') {
    loader.config({ monaco: monaco as never })
  }
}

function getLoadedMonaco(): MonacoLike | null {
  if (status !== 'idle') return monacoInstance
  const existing =
    (typeof loader?.__getMonacoInstance === 'function' ? loader.__getMonacoInstance() : null) ??
    getWindowMonaco()
  if (isValidMonaco(existing)) {
    monacoInstance = existing
    status = 'ready'
    registerWithReactLoader(existing)
    return existing
  }
  return null
}

export function getMonacoLoadStatus(): MonacoLoadStatus {
  if (getLoadedMonaco()) return 'ready'
  return status
}

export function ensureMonacoLoaded(timeoutMs = MONACO_LOAD_TIMEOUT_MS): Promise<MonacoLike> {
  const loaded = getLoadedMonaco()
  if (loaded) return Promise.resolve(loaded)
  if (loadPromise) return loadPromise

  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return Promise.reject(new Error('Monaco editor requires a browser environment'))
  }

  const currentAttempt = ++attemptId
  status = 'loading'
  loadPromise = new Promise<MonacoLike>((resolve, reject) => {
    // Cache either result for this document. Late AMD callbacks (or a late
    // window.monaco assignment) cannot revive an attempt that timed out.
    const isPending = () => currentAttempt === attemptId && status === 'loading'
    const finishOk = (monaco: MonacoLike) => {
      if (!isPending()) return
      registerWithReactLoader(monaco)
      monacoInstance = monaco
      status = 'ready'
      window.clearTimeout(timer)
      activeTimeoutId = null
      resolve(monaco)
    }
    const finishErr = (error: unknown) => {
      if (!isPending()) return
      status = 'failed'
      window.clearTimeout(timer)
      activeTimeoutId = null
      reject(error)
    }

    const timer = window.setTimeout(() => {
      finishErr(new Error('Monaco editor load timed out'))
    }, timeoutMs)
    activeTimeoutId = timer

    const loadEditorMain = () => {
      if (!isPending()) return
      try {
        const win = getMonacoWindow()
        const amdRequire = win.require
        if (typeof amdRequire !== 'function' || typeof amdRequire.config !== 'function') {
          finishErr(new Error('Monaco AMD loader did not initialize'))
          return
        }
        amdRequire.config({ paths: { vs: MONACO_VS_PATH } })
        amdRequire(
          ['vs/editor/editor.main'],
          (loadedModule) => {
            if (!isPending()) return
            const candidate = (loadedModule as { m?: unknown } | null)?.m ?? loadedModule ?? win.monaco
            if (isValidMonaco(candidate)) {
              finishOk(candidate)
            } else {
              finishErr(new Error('Monaco editor module did not expose editor API'))
            }
          },
          (error) => {
            finishErr(error ?? new Error('Monaco editor bundle failed to load'))
          },
        )
      } catch (error) {
        finishErr(error)
      }
    }

    const existingWindowRequire = getMonacoWindow().require
    if (typeof existingWindowRequire === 'function' && typeof existingWindowRequire.config === 'function') {
      loadEditorMain()
      return
    }

    const script = document.createElement('script')
    script.src = `${MONACO_VS_PATH}/loader.js`
    script.async = true
    script.onload = () => loadEditorMain()
    script.onerror = () => {
      script.remove()
      finishErr(new Error('Monaco loader script failed to load'))
    }
    document.body.appendChild(script)
  })

  // Prevent unhandledrejection if all callers unmount or time out before this settles.
  loadPromise.catch(() => undefined)
  return loadPromise
}

export function __resetMonacoLoaderForTests() {
  attemptId += 1
  if (activeTimeoutId !== null && typeof window !== 'undefined') {
    window.clearTimeout(activeTimeoutId)
  }
  activeTimeoutId = null
  status = 'idle'
  monacoInstance = null
  loadPromise = null
}
