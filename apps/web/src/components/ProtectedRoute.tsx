import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";

export function ProtectedRoute({ adminOnly }: { adminOnly?: boolean }) {
  const { user, loading } = useAuth();

  if (loading) return <div className="flex h-screen items-center justify-center text-gray-500">Загрузка…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== "ADMIN") return <Navigate to="/" replace />;
  return <Outlet />;
}
