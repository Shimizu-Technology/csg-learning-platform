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
let lastError: unknown = null

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

export function getLoadedMonaco(): MonacoLike | null {
  if (monacoInstance) return monacoInstance
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

export function ensureMonacoLoaded(): Promise<MonacoLike> {
  const loaded = getLoadedMonaco()
  if (loaded) return Promise.resolve(loaded)
  if (status === 'failed') return Promise.reject(lastError ?? new Error('Monaco editor failed to load'))
  if (loadPromise) return loadPromise

  if (typeof document === 'undefined' || typeof window === 'undefined') {
    status = 'failed'
    lastError = new Error('Monaco editor requires a browser environment')
    return Promise.reject(lastError)
  }

  status = 'loading'
  loadPromise = new Promise<MonacoLike>((resolve, reject) => {
    let settled = false
    const finishOk = (monaco: MonacoLike) => {
      if (settled) return
      settled = true
      monacoInstance = monaco
      status = 'ready'
      lastError = null
      registerWithReactLoader(monaco)
      resolve(monaco)
    }
    const finishErr = (error: unknown) => {
      if (settled) return
      settled = true
      status = 'failed'
      lastError = error
      reject(error)
    }

    const loadEditorMain = () => {
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
  status = 'idle'
  monacoInstance = null
  loadPromise = null
  lastError = null
}
