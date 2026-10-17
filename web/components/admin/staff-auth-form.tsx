"use client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export async function staffAuthRequest(path: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/auth${path}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.code ?? "AUTH_UNAVAILABLE");
  return result;
}
const messages: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Неверный email или пароль.", INVALID_PASSWORD: "Проверьте действующий пароль и требования к новому.",
  INVALID_CODE: "Неверный код подтверждения.",
  INVALID_BACKUP_CODE: "Неверный или уже использованный резервный код.",
  AUTH_RATE_LIMITED: "Слишком много попыток. Повторите позже.", TOO_MANY_REQUESTS: "Слишком много попыток. Повторите позже.",
  PASSWORD_OPERATION_INVALID: "Подтверждение истекло. Начните смену пароля заново.",
  TOTP_REPLAY: "Этот TOTP-код уже использован. Дождитесь нового кода.", EMAIL_DELIVERY_UNAVAILABLE: "Письмо пока не доставлено. Обратитесь к оператору.",
};
type Props = { mode: "login" | "enroll" | "challenge" | "password"; returnTo?: string };
export function StaffAuthForm({ mode, returnTo = "/admin" }: Props) {
  const router = useRouter();
  const navigate = (path: string) => { router.replace(path); router.refresh(); };
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const [enrollment, setEnrollment] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [backup, setBackup] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      if (mode === "login") {
        const result = await staffAuthRequest("/sign-in/email", { email: data.get("email"), password: data.get("password"), rememberMe: false });
        navigate(result.twoFactorRedirect ? `/admin/login/two-factor?${new URLSearchParams({ returnTo })}` : returnTo);
      } else if (mode === "enroll" && !enrollment) {
        setEnrollment(await staffAuthRequest("/two-factor/enable", { password: data.get("password") }));
      } else if (mode === "password" && !operationId) {
        const result = await staffAuthRequest("/password-change/start", { currentPassword: data.get("currentPassword"), newPassword: data.get("newPassword") });
        setOperationId(result.operationId);
      } else if (mode === "password") {
        await staffAuthRequest("/password-change/confirm", { operationId, code: data.get("code") });
        navigate("/admin/login");
      } else {
        await staffAuthRequest(backup ? "/two-factor/verify-backup-code" : "/two-factor/verify-totp", { code: data.get("code"), trustDevice: false });
        navigate(returnTo);
      }
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "AUTH_UNAVAILABLE";
      setError(messages[code] ?? "Операция недоступна. Повторите позже или обратитесь к оператору.");
    } finally { setPending(false); }
  }
  const input = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
  return <div className="space-y-4"><form onSubmit={submit} className="space-y-4">
    {mode === "login" && <>
      <label className="block">Email<input className={input} name="email" type="email" autoComplete="username" required /></label>
      <label className="block">Пароль<input className={input} name="password" type="password" autoComplete="current-password" maxLength={128} required /></label>
      <p>Регистрация закрыта. Для получения или перевыдачи пароля обратитесь к владельцу.</p>
    </>}
    {mode === "enroll" && !enrollment && <>
      <p>Для Super Admin обязателен TOTP. До подключения административный доступ закрыт.</p>
      <label className="block">Действующий пароль<input className={input} name="password" type="password" autoComplete="current-password" maxLength={128} required /></label>
    </>}
    {enrollment && <div className="space-y-3">
      <p>Добавьте секрет в приложение аутентификации вручную. Сохраните резервные коды в защищённом месте. Каждый код используется один раз.</p>
      <p>Секрет: <code className="break-all">{new URL(enrollment.totpURI).searchParams.get("secret")}</code></p>
      <a href={enrollment.totpURI}>Открыть приложение аутентификации</a>
      <pre className="whitespace-pre-wrap">{enrollment.backupCodes.join("\n")}</pre>
      <label><input type="checkbox" required /> Я сохранил резервные коды</label>
    </div>}
    {mode === "password" && !operationId && <>
      <label className="block">Действующий пароль<input className={input} name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required /></label>
      <label className="block">Новый пароль (15–128 символов)<input className={input} name="newPassword" type="password" autoComplete="new-password" minLength={15} maxLength={128} required /></label>
      <p>После подтверждения TOTP все сессии будут отозваны.</p>
    </>}
    {(mode === "challenge" || enrollment || operationId) && <label className="block">{backup ? "Резервный код" : "Код TOTP"}<input className={input} name="code" autoComplete="one-time-code" inputMode={backup ? "text" : "numeric"} pattern={backup ? undefined : "[0-9]{6}"} required /></label>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <Button type="submit" disabled={pending}>{pending ? "Проверка…" : mode === "login" ? "Войти" : mode === "enroll" && !enrollment ? "Подключить TOTP" : "Подтвердить"}</Button>
    {mode === "challenge" && <Button type="button" variant="outline" disabled={pending} onClick={() => setBackup(!backup)}>{backup ? "Использовать TOTP" : "Использовать резервный код"}</Button>}
  </form>{mode !== "login" && <Button variant="outline" disabled={pending} onClick={async () => {
    setPending(true);
    try { await staffAuthRequest("/sign-out", {}); navigate("/admin/login"); }
    catch { setError("Не удалось выйти. Повторите попытку."); setPending(false); }
  }}>Выйти</Button>}</div>;
}
