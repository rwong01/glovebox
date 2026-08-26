import { Navigate, Route, Routes } from 'react-router-dom'

import { Spinner } from './components/ui/States.jsx'
import { useAuth } from './hooks/useAuth.js'
import Garage from './pages/Garage.jsx'
import Login from './pages/Login.jsx'
import Upload from './pages/Upload.jsx'
import VehicleDetail from './pages/VehicleDetail.jsx'

function Protected({ children }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg">
        <Spinner label="Checking your session" />
      </div>
    )
  }
  return user ? children : <Navigate to="/login" replace />
}

export default function App() {
  const { user, loading } = useAuth()

  return (
    <Routes>
      <Route
        path="/login"
        element={loading ? null : user ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/"
        element={
          <Protected>
            <Garage />
          </Protected>
        }
      />
      <Route
        path="/vehicle/:vehicleId"
        element={
          <Protected>
            <VehicleDetail />
          </Protected>
        }
      />
      <Route
        path="/vehicle/:vehicleId/scan"
        element={
          <Protected>
            <Upload />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
