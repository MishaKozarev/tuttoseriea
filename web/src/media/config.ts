import "server-only";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { mediaError } from "./errors";

export type MediaStorageConfig = { root: string; environment: "local" | "staging" | "production" };
export const MEDIA_ENVIRONMENT_MARKER = ".media-environment";

export function getMediaStorageConfig(env: Record<string, string | undefined> = process.env): MediaStorageConfig {
  const root = env.MEDIA_STORAGE_ROOT;
  const environment = env.MEDIA_STORAGE_ENV;
  if (!root || root !== root.trim() || !path.isAbsolute(root) ||
      !["local", "staging", "production"].includes(environment ?? "")) {
    throw mediaError("MEDIA_STORAGE_UNAVAILABLE", 503, "Media storage is not configured");
  }
  return { root: path.resolve(root), environment: environment as MediaStorageConfig["environment"] };
}

function unescapeMountPath(value: string): string {
  return value.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));
}

export function hasExactMount(mountInfo: string, root: string): boolean {
  return mountInfo.split("\n").some(line => {
    const fields = line.split(" ");
    return fields.length >= 10 && fields.includes("-") && unescapeMountPath(fields[4]) === root;
  });
}

// Test overrides exercise platform/mount validation without changing live mounts.
export async function validateMediaRoot(config: MediaStorageConfig, options: { platform?: string; mountInfo?: string } = {}): Promise<string> {
  try {
    const root = await realpath(config.root);
    const stat = await lstat(config.root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || path.resolve(root) !== config.root) throw new Error("Invalid Media directory");
    const marker = await lstat(path.join(root, MEDIA_ENVIRONMENT_MARKER));
    if (!marker.isFile() || marker.isSymbolicLink() || marker.size > 32 ||
      (await readFile(path.join(root, MEDIA_ENVIRONMENT_MARKER), "utf8")).trim() !== config.environment) throw new Error("Invalid Media environment");
    const platform = options.platform ?? process.platform;
    if (platform === "linux") {
      const mounts = options.mountInfo ?? await readFile("/proc/self/mountinfo", "utf8");
      if (!hasExactMount(mounts, root)) throw new Error("Media root is not a mountpoint");
    } else if (platform !== "win32" || config.environment !== "local") {
      throw new Error("Unsupported Media runtime");
    }
    return root;
  } catch {
    throw mediaError("MEDIA_STORAGE_UNAVAILABLE", 503, "Media storage is unavailable");
  }
}
