import { useEffect } from 'react'
import { Shell } from './components/Shell'
import { ToastProvider } from './components/ui'
import { navigate, RouterProvider, useLocation } from './lib/router'
import { DataProvider, useData } from './lib/store'
import { configured } from './lib/supabase'
import { importKeys } from './lib/owner'
import { AdminScreen } from './screens/AdminScreen'
import { MyVisitsScreen } from './screens/MyVisitsScreen'
import { NotesScreen } from './screens/NotesScreen'
import { PlanningScreen } from './screens/PlanningScreen'
import { SetupScreen } from './screens/SetupScreen'
import { TodayScreen } from './screens/TodayScreen'

function ImportLink() {
  const { hash } = useLocation()
  const { refreshMine } = useData()
  useEffect(() => {
    const n = importKeys(hash)
    // On efface la clé de la barre d'adresse.
    navigate(n ? '/mes-visites?retrouve=1' : '/mes-visites', { replace: true })
    if (n) void refreshMine()
  }, [hash, refreshMine])
  return null
}

function Routes() {
  const { path } = useLocation()
  switch (path.replace(/\/+$/, '') || '/') {
    case '/aujourdhui':
      return <TodayScreen />
    case '/mes-visites':
      return <MyVisitsScreen />
    case '/mots':
      return <NotesScreen />
    case '/admin':
      return <AdminScreen />
    case '/m':
      return <ImportLink />
    default:
      return <PlanningScreen />
  }
}

export default function App() {
  if (!configured) return <SetupScreen />
  return (
    <RouterProvider>
      <DataProvider>
        <ToastProvider>
          <Shell>
            <Routes />
          </Shell>
        </ToastProvider>
      </DataProvider>
    </RouterProvider>
  )
}
