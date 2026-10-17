/** Shared .env.local helpers for the chain-* scripts. Never prints secret values. */
import fs from "node:fs";

export const ENV_FILE = ".env.local";

export function loadEnv() {
  for (const f of [ENV_FILE, ".env"]) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]] && m[2]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

/** Set (or replace) KEY=value in .env.local and process.env. */
export function setEnv(key: string, value: string) {
  const text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";
  const re = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
  const line = `${key}=${value}`;
  const next = re.test(text) ? text.replace(re, line) : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
  fs.writeFileSync(ENV_FILE, next);
  process.env[key] = value;
}
