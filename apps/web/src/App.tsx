import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./lib/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/Login";
import { RegisterPage } from "./pages/Register";
import { FileManagerPage } from "./pages/FileManager";
import { TrashPage } from "./pages/Trash";
import { AdminPage } from "./pages/Admin";
import { AgentPage } from "./pages/Agent";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        <Route element={<ProtectedRoute />}>
          <Route
            path="/"
            element={
              <Layout>
                <FileManagerPage />
              </Layout>
            }
          />
          <Route
            path="/agent"
            element={
              <Layout>
                <AgentPage />
              </Layout>
            }
          />
          <Route
            path="/trash"
            element={
              <Layout>
                <TrashPage />
              </Layout>
            }
          />
        </Route>

        <Route element={<ProtectedRoute adminOnly />}>
          <Route
            path="/admin"
            element={
              <Layout>
                <AdminPage />
              </Layout>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
