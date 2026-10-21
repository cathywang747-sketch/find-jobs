import fs from "node:fs/promises";
import { all, q, run } from "../db/sqlite.mjs";
import { normalizeCompanyName, normalizeRoleName } from "../services/job-import.mjs";

const schema = await fs.readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
// Columns added to an existing database must exist before their indexes and triggers are created.
const deferredStatements = [
  "CREATE INDEX IF NOT EXISTS idx_jobs_source_category ON jobs(source_category);",
  "CREATE INDEX IF NOT EXISTS idx_jobs_company_role_key ON jobs(company_key, role_key);",
  "CREATE INDEX IF NOT EXISTS idx_jobs_canonical_url ON jobs(canonical_url);",
  "CREATE INDEX IF NOT EXISTS idx_tasks_job_id ON tasks(job_id);",
  "CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);",
  `CREATE TRIGGER IF NOT EXISTS tasks_updated_at AFTER UPDATE ON tasks FOR EACH ROW BEGIN
  UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;`
];
let baselineSchema = schema;
for (const statement of deferredStatements) baselineSchema = baselineSchema.replace(statement, "");
await run(baselineSchema);

const columns = await all("PRAGMA table_info(applications)");
if (!columns.some((c) => c.name === "job_id")) await run("ALTER TABLE applications ADD COLUMN job_id INTEGER REFERENCES jobs(id);");
if (!columns.some((c) => c.name === "resume_version_id")) await run("ALTER TABLE applications ADD COLUMN resume_version_id INTEGER REFERENCES resume_versions(id);");
if (!columns.some((c) => c.name === "application_url")) await run("ALTER TABLE applications ADD COLUMN application_url TEXT;");
const jobColumns = await all("PRAGMA table_info(jobs)");
if (!jobColumns.some((c) => c.name === "source_category")) await run("ALTER TABLE jobs ADD COLUMN source_category TEXT NOT NULL DEFAULT '其他/待确认';");
if (!jobColumns.some((c) => c.name === "company_type")) await run("ALTER TABLE jobs ADD COLUMN company_type TEXT;");
if (!jobColumns.some((c) => c.name === "is_saved")) await run("ALTER TABLE jobs ADD COLUMN is_saved INTEGER NOT NULL DEFAULT 0;");
if (!jobColumns.some((c) => c.name === "company_key")) await run("ALTER TABLE jobs ADD COLUMN company_key TEXT;");
if (!jobColumns.some((c) => c.name === "role_key")) await run("ALTER TABLE jobs ADD COLUMN role_key TEXT;");

const taskColumns = await all("PRAGMA table_info(tasks)");
if (!taskColumns.some((c) => c.name === "status")) await run("ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'open';");
if (!taskColumns.some((c) => c.name === "priority")) await run("ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';");
if (!taskColumns.some((c) => c.name === "updated_at")) await run("ALTER TABLE tasks ADD COLUMN updated_at TEXT;");

await run(`
  UPDATE jobs SET is_saved=1, review_status='pending_review' WHERE review_status='saved';
  UPDATE jobs SET review_status='confirmed' WHERE review_status='converted';
  UPDATE tasks SET status=CASE WHEN completed_at IS NULL THEN 'open' ELSE 'done' END
    WHERE status IS NULL OR status NOT IN ('open','done','cancelled');
  UPDATE tasks SET priority='normal' WHERE priority IS NULL OR priority NOT IN ('normal','important','urgent');
  UPDATE tasks SET updated_at=COALESCE(updated_at,created_at,CURRENT_TIMESTAMP);
`);
const jobsToNormalize = await all("SELECT id, company, role FROM jobs WHERE company_key IS NULL OR role_key IS NULL OR company_key='' OR role_key='' ");
for (const job of jobsToNormalize) {
  await run(`UPDATE jobs SET company_key=${q(normalizeCompanyName(job.company))},role_key=${q(normalizeRoleName(job.role))} WHERE id=${job.id}`);
}
for (const statement of deferredStatements) await run(statement);
await run("PRAGMA optimize;");
console.log("migration ok");
