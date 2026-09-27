import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";

export const PERSISTENT_ON = "on";
export const PERSISTENT_OFF = "off";

export function settingsPath() {
  const overridden = String(process.env.SHIPGUARD_MISSION_LOCK_CONFIG || "").trim();
  return overridden || join(homedir(), ".shipguard", "mission-lock.json");
}

export function readPersistentMode() {
  try {
    const settings = JSON.parse(readFileSync(settingsPath(), "utf8"));
    return settings?.defaultMode === PERSISTENT_OFF ? PERSISTENT_OFF : PERSISTENT_ON;
  } catch {
    return PERSISTENT_ON;
  }
}

export function writePersistentMode(defaultMode) {
  if (defaultMode !== PERSISTENT_ON && defaultMode !== PERSISTENT_OFF) {
    throw new Error(`Unsupported persistent mode: ${defaultMode}`);
  }

  const target = settingsPath();
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  writeFileSync(
    temporary,
    `${JSON.stringify({ version: 1, defaultMode }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  renameSync(temporary, target);
  return target;
}
