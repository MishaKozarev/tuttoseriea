import { createHmac } from "node:crypto";
export function totpCode(uri: string, at = Date.now()): string {
  const value = new URL(uri).searchParams.get("secret")!;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  return ((digest.readUInt32BE(digest[digest.length - 1] & 15) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}
export function updateCookies(response: Response, previous = ""): string {
  const cookies = new Map(previous.split(";").filter(Boolean).map(part => { const i = part.indexOf("="); return [part.slice(0, i).trim(), part.slice(i + 1)] as const; }));
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";")[0], i = pair.indexOf("=");
    if (/max-age=0/i.test(value)) cookies.delete(pair.slice(0, i));
    else cookies.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
}
