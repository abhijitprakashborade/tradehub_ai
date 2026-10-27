import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Apply theme before first render to avoid flash
const savedTheme = (() => {
  try {
    const stored = localStorage.getItem('tradehub-theme')
    if (stored) {
      const parsed = JSON.parse(stored)
      return parsed?.state?.theme
    }
  } catch {
    // malformed persisted theme — fall through to system preference
  }
  return null
})()

if (
  savedTheme === 'dark' ||
  (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)
) {
  document.documentElement.classList.add('dark')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
