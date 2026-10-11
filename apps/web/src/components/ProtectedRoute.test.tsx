// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { UserDto } from "@filehub/shared";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProtectedRoute } from "./ProtectedRoute";

const auth = vi.hoisted(() => ({
  state: {
    user: null as UserDto | null,
    loading: true,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  },
}));

vi.mock("../lib/AuthContext", () => ({
  useAuth: () => auth.state,
}));

const user: UserDto = {
  id: "user-1",
  email: "a@example.com",
  role: "USER",
  storageQuotaBytes: 1,
  storageUsedBytes: 0,
  isBlocked: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function renderRoute(adminOnly = false) {
  return render(
    <MemoryRouter initialEntries={["/secret"]}>
      <Routes>
        <Route path="/login" element={<div>login-screen</div>} />
        <Route path="/" element={<div>home-screen</div>} />
        <Route element={<ProtectedRoute adminOnly={adminOnly} />}>
          <Route path="/secret" element={<div>secret-screen</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute", () => {
  beforeEach(() => {
    auth.state.user = null;
    auth.state.loading = true;
  });

  it("waits, then sends anonymous visitors to login", () => {
    renderRoute();
    expect(screen.getByText("Загрузка…")).toBeTruthy();
  });

  it("sends anonymous visitors to login", () => {
    auth.state.loading = false;
    renderRoute();
    expect(screen.getByText("login-screen")).toBeTruthy();
  });

  it("renders the page for a signed-in user", () => {
    auth.state.loading = false;
    auth.state.user = user;
    renderRoute();
    expect(screen.getByText("secret-screen")).toBeTruthy();
  });

  it("sends non-admins away from admin routes and lets admins through", () => {
    auth.state.loading = false;
    auth.state.user = user;
    const denied = renderRoute(true);
    expect(screen.getByText("home-screen")).toBeTruthy();
    denied.unmount();

    auth.state.user = { ...user, role: "ADMIN" };
    renderRoute(true);
    expect(screen.getByText("secret-screen")).toBeTruthy();
  });
});
