import { createContext, useContext, useReducer, useCallback } from 'react'

// ---------- Initial state ----------
const initialState = {
  /** @type {{ name: string, size: number, type: string, file: File } | null} */
  currentFile: null,
  /** @type {'idle' | 'loading' | 'ready' | 'error'} */
  previewStatus: 'idle',
  /** @type {string | null} */
  errorMessage: null,
  /** @type {number} 50 – 200 */
  zoomLevel: 100,
  /** @type {boolean} */
  isConverting: false,
  /** @type {string | null} */
  convertProgress: null,
}

// ---------- Actions ----------
const Actions = {
  SET_FILE: 'SET_FILE',
  CLEAR_FILE: 'CLEAR_FILE',
  SET_PREVIEW_STATUS: 'SET_PREVIEW_STATUS',
  SET_ERROR: 'SET_ERROR',
  CLEAR_ERROR: 'CLEAR_ERROR',
  SET_ZOOM: 'SET_ZOOM',
  SET_CONVERTING: 'SET_CONVERTING',
  SET_CONVERT_PROGRESS: 'SET_CONVERT_PROGRESS',
}

function reducer(state, action) {
  switch (action.type) {
    case Actions.SET_FILE:
      return { ...state, currentFile: action.payload, previewStatus: 'loading', errorMessage: null }
    case Actions.CLEAR_FILE:
      return { ...initialState }
    case Actions.SET_PREVIEW_STATUS:
      return { ...state, previewStatus: action.payload }
    case Actions.SET_ERROR:
      return { ...state, errorMessage: action.payload, previewStatus: 'error' }
    case Actions.CLEAR_ERROR:
      return { ...state, errorMessage: null }
    case Actions.SET_ZOOM:
      return { ...state, zoomLevel: action.payload }
    case Actions.SET_CONVERTING:
      return { ...state, isConverting: action.payload, convertProgress: action.payload ? state.convertProgress : null }
    case Actions.SET_CONVERT_PROGRESS:
      return { ...state, convertProgress: action.payload }
    default:
      return state
  }
}

// ---------- Context ----------
const FileContext = createContext(null)

export function FileProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const actions = {
    setFile: useCallback((file) => dispatch({ type: Actions.SET_FILE, payload: file }), []),
    clearFile: useCallback(() => dispatch({ type: Actions.CLEAR_FILE }), []),
    setPreviewStatus: useCallback((s) => dispatch({ type: Actions.SET_PREVIEW_STATUS, payload: s }), []),
    setError: useCallback((msg) => dispatch({ type: Actions.SET_ERROR, payload: msg }), []),
    clearError: useCallback(() => dispatch({ type: Actions.CLEAR_ERROR }), []),
    setZoom: useCallback((z) => dispatch({ type: Actions.SET_ZOOM, payload: z }), []),
    setConverting: useCallback((v) => dispatch({ type: Actions.SET_CONVERTING, payload: v }), []),
    setConvertProgress: useCallback((p) => dispatch({ type: Actions.SET_CONVERT_PROGRESS, payload: p }), []),
  }

  return (
    <FileContext.Provider value={{ ...state, ...actions }}>
      {children}
    </FileContext.Provider>
  )
}

export function useFileStore() {
  const ctx = useContext(FileContext)
  if (!ctx) throw new Error('useFileStore must be used within <FileProvider>')
  return ctx
}
