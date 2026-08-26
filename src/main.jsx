import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App.jsx'
import SetupNeeded from './pages/SetupNeeded.jsx'
import { AuthProvider } from './context/AuthProvider.jsx'
import { ThemeProvider } from './context/ThemeProvider.jsx'
import { isSupabaseConfigured } from './lib/supabaseClient.js'
import './index.css'

// Without real credentials there is nothing to sign in to, so show the setup
// steps instead of letting the app fail somewhere less explicable.
const root = isSupabaseConfigured ? (
  <BrowserRouter>
    <AuthProvider>
      <App />
    </AuthProvider>
  </BrowserRouter>
) : (
  <SetupNeeded />
)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>{root}</ThemeProvider>
  </StrictMode>,
)
