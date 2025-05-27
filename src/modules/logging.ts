import { writeFileSync, appendFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const LOG_FILE = join(homedir(), "mcpcat.log");

export function writeToLog(message: string): void {
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
