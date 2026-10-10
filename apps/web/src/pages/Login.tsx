import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { ApiError } from "../lib/api";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось войти");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <form onSubmit={onSubmit} className="fh-card mt-bounce-in p-6 sm:p-8 w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold mt-gradient-text">FileHub AI — вход</h1>
        <p className="text-sm text-gray-500">Доступ только для сотрудников организации, подключённых к корпоративной сети.</p>
        {error && <div className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</div>}
        <div>
          <label className="block text-sm text-gray-600 mb-1">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">Пароль</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="w-full mt-btn rounded-lg py-2 text-sm font-medium disabled:opacity-50"
        >
          Войти
        </button>
        <p className="text-sm text-gray-500 text-center">
          Нет аккаунта?{" "}
          <Link to="/register" className="text-brand-600 hover:underline">
            Зарегистрироваться
          </Link>
        </p>
      </form>
    </div>
  );
}
