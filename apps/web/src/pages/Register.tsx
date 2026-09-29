import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { ApiError } from "../lib/api";

export function RegisterPage() {
  const { register } = useAuth();
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
      await register(email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось зарегистрироваться");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center bg-gray-50 px-4">
      <form onSubmit={onSubmit} className="bg-white shadow rounded-xl p-6 sm:p-8 w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold text-brand-700">Регистрация в FileHub AI</h1>
        <p className="text-sm text-gray-500">Первый зарегистрированный пользователь автоматически получает роль администратора.</p>
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
          className="w-full bg-brand-600 text-white rounded py-2 text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          Зарегистрироваться
        </button>
        <p className="text-sm text-gray-500 text-center">
          Уже есть аккаунт?{" "}
          <Link to="/login" className="text-brand-600 hover:underline">
            Войти
          </Link>
        </p>
      </form>
    </div>
  );
}
