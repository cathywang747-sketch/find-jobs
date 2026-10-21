import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const defaultDbPath = fileURLToPath(new URL("./applications.db", import.meta.url));
const dbPath = process.env.RESUME_AUTOMATION_DB_PATH
  ? path.resolve(process.env.RESUME_AUTOMATION_DB_PATH)
  : defaultDbPath;

export async function all(sql) {
  const { stdout } = await execFileAsync("sqlite3", ["-json", dbPath, `PRAGMA foreign_keys = ON;\n${sql}`]);
  return stdout.trim() ? JSON.parse(stdout) : [];
}

export async function run(sql) {
  await execFileAsync("sqlite3", [dbPath, `PRAGMA foreign_keys = ON;\n${sql}`]);
}

export function q(value) {
  if (value === null || value === undefined || value === "") return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

export { dbPath };
