import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import AppLayout from './components/layout/AppLayout'

// Pages
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Editor from './pages/Editor'
import ItemDetail from './pages/ItemDetail'
import Analysis from './pages/Analysis'
import AIPlans from './pages/AIPlans'
import ImportExcel from './pages/ImportExcel'
import NewProject from './pages/NewProject'
import Export from './pages/Export'
import MarkupChain from './pages/MarkupChain'
import CargarObra from './pages/CargarObra'
import Catalogs from './pages/Catalogs'
import Versions from './pages/Versions'
import DiferenciasExcel from './pages/DiferenciasExcel'
import Templates from './pages/Templates'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Root → redirect to dashboard */}
          <Route path="/" element={<Navigate to="/app/dashboard" replace />} />

          {/* Auth */}
          <Route path="/login" element={<Login />} />

          {/* App shell */}
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="budgets/:id/editor" element={<Editor />} />
            <Route path="budgets/:id/item/:itemId" element={<ItemDetail />} />
            <Route path="budgets/:id/analysis" element={<Analysis />} />
            <Route path="budgets/:id/ai" element={<AIPlans />} />
            <Route path="budgets/:id/export" element={<Export />} />
            <Route path="budgets/:id/versions" element={<Versions />} />
            <Route path="budgets/:id/diferencias" element={<DiferenciasExcel />} />
            <Route path="new-project" element={<NewProject />} />
            <Route path="import" element={<ImportExcel />} />
            <Route path="cargar-obra" element={<CargarObra />} />
            <Route path="settings/markups" element={<MarkupChain />} />
            <Route path="catalogs" element={<Catalogs />} />
            <Route path="templates" element={<Templates />} />
          </Route>

          {/* 404 */}
          <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
