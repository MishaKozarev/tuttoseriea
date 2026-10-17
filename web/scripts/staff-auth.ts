import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { createInterface } from "node:readline/promises";
import pg from "pg";
import { existsSync } from "node:fs";
import { getAuthConfig } from "../src/auth/config";
import { operateStaff, notifyStaffOperation, retireLegacyAuth, type StaffOperatorCommand } from "../src/auth/operator";
import { AuthSecurityError } from "../src/auth/security-store";
import { createAuthEmailSender } from "../src/email/resend";

for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);
async function hiddenPassword(label: string): Promise<string> {
  process.stdout.write(label);
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = () => { process.stdin.off("data", read); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write("\n"); };
    const read = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") { finish(); reject(new Error("CANCELLED")); return; }
        if (character === "\r" || character === "\n") { finish(); resolve(value); return; }
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else if (character >= " ") value += character;
      }
    };
    process.stdin.on("data", read);
  });
}
async function main() {
  if (process.argv.slice(2).length === 1 && process.argv[2] === "--check-runtime") {
    console.log("staff_operator_runtime=ready database_connections=0 email_requests=0");
    return;
  }
  const args = new Map(process.argv.slice(2).map(value => {
    const match = /^--(stage|action|email|roles|operation-id)=(.+)$/.exec(value);
    if (!match) throw new Error("INVALID_ARGUMENT");
    return [match[1], match[2]] as const;
  }));
  const stage = args.get("stage"), action = args.get("action");
  const config = getAuthConfig();
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  if (!connectionString) throw new Error("MIGRATION_DATABASE_URL_REQUIRED");
  const db = new URL(connectionString);
  if (stage === "local") {
    if (!["localhost", "127.0.0.1"].includes(db.hostname) || db.port !== "15432" || !["localhost", "127.0.0.1"].includes(new URL(config.origin).hostname)) throw new Error("LOCAL_ONLY");
  } else if (stage === "staging") {
    if (config.origin !== "https://staging.tuttoseriea.com" || process.getuid?.() !== 0) throw new Error("TRUSTED_ROOT_OPERATOR_REQUIRED");
  } else throw new Error("EXPLICIT_LOCAL_OR_STAGING_REQUIRED");
  const operator = `os:${userInfo().username}:${process.env.SUDO_USER ?? "direct"}`;
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    if (action === "preflight") {
      const { rows } = await pool.query<{ email: string | null }>("select email from auth.users");
      const emails = rows.map(row => row.email?.normalize("NFKC").trim().toLowerCase() ?? null);
      const invalid = emails.filter(value => !value).length;
      const noncanonical = rows.filter((row, index) => row.email !== emails[index]).length;
      const duplicates = emails.length - new Set(emails).size;
      console.log({ users: rows.length, invalidEmails: invalid, noncanonicalEmails: noncanonical, duplicateEmails: duplicates });
      if (invalid || noncanonical || duplicates) throw new Error("IDENTITY_PREFLIGHT_REQUIRES_OPERATOR_REVIEW");
      return;
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("INTERACTIVE_OPERATOR_REQUIRED");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    if (action === "retire-legacy") {
      if (config.writesEnabled || process.env.AUTH_STAFF_EMAIL_DELIVERY !== "disabled" || process.env.AUTH_EMAIL_SERVER) throw new Error("STOP_AUTH_WRITES_AND_OLD_DELIVERY_FIRST");
      const confirmation = await rl.question("Auth writes и legacy delivery должны быть остановлены на всех replicas. Введите RETIRE LEGACY AUTH: "); rl.close();
      console.log(await retireLegacyAuth(pool, config.secret, operator, confirmation)); return;
    }
    const operationId = args.get("operation-id") ?? randomUUID();
    if (action === "retry-notification") {
      rl.close(); await notifyStaffOperation(pool, config.secret, operationId, createAuthEmailSender()); console.log("Notification delivered"); return;
    }
    if (!["provision", "grant-roles", "reissue-password", "recover-mfa", "disable"].includes(action ?? "")) throw new Error("INVALID_ACTION");
    const email = args.get("email") ?? "";
    const target = await pool.query("select a.id,u.email,a.status from auth.users u join identity.accounts a on a.auth_user_id=u.id where u.email=$1", [email]);
    console.log({ action, operationId, target: target.rows[0] ?? { email, account: "new" } });
    const confirmation = await rl.question("Для подтверждения введите точный email целевого Account: "); rl.close();
    let password: string | undefined;
    if (action === "provision" || action === "reissue-password") {
      password = await hiddenPassword("Новый пароль (15–128 символов, ввод скрыт): ");
      if (await hiddenPassword("Повторите пароль: ") !== password) throw new Error("PASSWORDS_DIFFER");
    }
    const result = await operateStaff(pool, config.secret, { action: action as StaffOperatorCommand["action"], email, operator, operationId, confirmation, password, roles: args.get("roles")?.split(",") });
    console.log({ ...result, operationId, outcome: "applied" });
    await notifyStaffOperation(pool, config.secret, operationId, createAuthEmailSender());
    console.log("Notification delivered");
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error instanceof AuthSecurityError ? error.code : "STAFF_OPERATOR_FAILED (проверьте arguments, stage и защищённую конфигурацию)"); process.exitCode = 1; });
