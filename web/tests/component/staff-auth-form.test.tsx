// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StaffAuthForm } from "@/components/admin/staff-auth-form";
const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("Staff auth forms", () => {
  it("uses password login and routes a pending MFA challenge without another login", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ twoFactorRedirect: true })); vi.stubGlobal("fetch", fetch);
    render(<StaffAuthForm mode="login" returnTo="/admin/football" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "staff@example.invalid" } });
    fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "synthetic staff password" } });
    fireEvent.submit(screen.getByRole("button", { name: "Войти" }).closest("form")!);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/admin/login/two-factor?returnTo=%2Fadmin%2Ffootball"));
    expect(fetch.mock.calls[0][0]).toBe("/api/auth/sign-in/email"); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps invalid credentials visible without navigating or exposing server messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: "INVALID_EMAIL_OR_PASSWORD", message: "internal secret" } }, { status: 401 })));
    render(<StaffAuthForm mode="login" />); fireEvent.submit(screen.getByRole("button", { name: "Войти" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Неверный email или пароль"));
    expect(screen.queryByText("internal secret")).toBeNull(); expect(navigation.replace).not.toHaveBeenCalled();
  });
  it("binds the TOTP confirmation to the operation returned after password recheck", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ operationId: "synthetic-operation" })).mockResolvedValueOnce(Response.json({ status: true })); vi.stubGlobal("fetch", fetch);
    render(<StaffAuthForm mode="password" />);
    fireEvent.change(screen.getByLabelText("Действующий пароль"), { target: { value: "synthetic old password" } });
    fireEvent.change(screen.getByLabelText(/Новый пароль/), { target: { value: "synthetic new password" } });
    fireEvent.submit(screen.getByRole("button", { name: "Подтвердить" }).closest("form")!);
    await screen.findByLabelText("Код TOTP");
    expect(screen.queryByLabelText("Действующий пароль")).toBeNull();
    fireEvent.change(screen.getByLabelText("Код TOTP"), { target: { value: "123456" } });
    fireEvent.submit(screen.getByRole("button", { name: "Подтвердить" }).closest("form")!);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/admin/login"));
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ operationId: "synthetic-operation", code: "123456" });
    expect(fetch.mock.calls[1][0]).toBe("/api/auth/password-change/confirm");
  });
});
