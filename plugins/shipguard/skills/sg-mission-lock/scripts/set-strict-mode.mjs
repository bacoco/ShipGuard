#!/usr/bin/env node

import process from "node:process";
import {
  PERSISTENT_OFF,
  PERSISTENT_ON,
  readPersistentMode,
  settingsPath,
  writePersistentMode,
} from "./strict-mode.mjs";

const action = process.argv[2] || "status";

if (action === "status") {
  process.stdout.write(`${JSON.stringify({ defaultMode: readPersistentMode(), path: settingsPath() })}\n`);
} else if (action === "on") {
  const path = writePersistentMode(PERSISTENT_ON);
  process.stdout.write(`${JSON.stringify({ defaultMode: PERSISTENT_ON, path })}\n`);
} else if (action === "off-persistent") {
  const path = writePersistentMode(PERSISTENT_OFF);
  process.stdout.write(`${JSON.stringify({ defaultMode: PERSISTENT_OFF, path })}\n`);
} else {
  process.stderr.write("Expected one of: status, on, off-persistent\n");
  process.exitCode = 2;
}
