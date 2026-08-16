import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { requestPersistence } from './db/db'
import './styles.css'

// Ask up front, so a long log is never evicted under storage pressure.
void requestPersistence()

async function boot() {
  // Dev-only: `?demo=1` wipes the database and fills it with six weeks of
  // plausible history, so the screens can be reviewed without waiting.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('demo')) {
    const { seedDemo } = await import('./db/demo')
    await seedDemo()
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void boot()
