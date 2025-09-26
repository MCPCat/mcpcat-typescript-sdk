import { writeFileSync, appendFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// Safely determine log file path, handling environments where homedir() may return null
let LOG_FILE: string | null = null;
try {
  const home = homedir();
  if (home && home !== null && home !== undefined) {
    LOG_FILE = join(home, "mcpcat.log");
  }
} catch {
  // If homedir() or join() fails, LOG_FILE remains null
  LOG_FILE = null;
}

export function writeToLog(message: string): void {
  // Skip logging if we don't have a valid log file path
  if (!LOG_FILE) {
    return;
  }

  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;

  try {
    if (!existsSync(LOG_FILE)) {
      writeFileSync(LOG_FILE, logEntry);
    } else {
      appendFileSync(LOG_FILE, logEntry);
    }
  } catch {
    // Silently fail to avoid breaking the server
  }
}
