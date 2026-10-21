PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, company TEXT NOT NULL, role TEXT NOT NULL,
  job_url TEXT NOT NULL, application_url TEXT, canonical_url TEXT, company_key TEXT, role_key TEXT, source_name TEXT,
  source_type TEXT, source_category TEXT NOT NULL DEFAULT '其他/待确认', company_type TEXT, location TEXT, work_mode TEXT, employment_type TEXT, recruiting_type TEXT,
  description TEXT, published_at TEXT, deadline TEXT, discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fetched_at TEXT, fingerprint TEXT UNIQUE, review_status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (review_status IN ('pending_review','confirmed','rejected','expired')),
  is_saved INTEGER NOT NULL DEFAULT 0 CHECK (is_saved IN (0,1)),
  rejection_reason TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS job_ai_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  model_name TEXT, match_score REAL, campus_signal INTEGER, confidence REAL,
  required_skills TEXT, preferred_skills TEXT, match_reasons TEXT, skill_gaps TEXT,
  evidence TEXT, raw_result TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS resume_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER REFERENCES jobs(id), parent_resume_id INTEGER REFERENCES resume_versions(id),
  name TEXT NOT NULL, resume_type TEXT NOT NULL DEFAULT 'base' CHECK (resume_type IN ('base','tailored','reusable')), tags TEXT, profile_snapshot TEXT NOT NULL,
  job_snapshot TEXT, generation_notes TEXT, docx_path TEXT, pdf_path TEXT, usage_count INTEGER NOT NULL DEFAULT 0,
  version_number INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS job_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, source_type TEXT NOT NULL, base_url TEXT,
  keywords TEXT, enabled INTEGER NOT NULL DEFAULT 1, last_crawled_at TEXT, last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER REFERENCES jobs(id), application_id INTEGER REFERENCES applications(id),
  task_type TEXT NOT NULL, title TEXT NOT NULL, due_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','important','urgent')),
  completed_at TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER REFERENCES jobs(id), resume_version_id INTEGER REFERENCES resume_versions(id),
  company TEXT NOT NULL, role TEXT NOT NULL, job_url TEXT, application_url TEXT, ats_type TEXT,
  status TEXT NOT NULL DEFAULT 'collected', resume_version TEXT, cover_letter_version TEXT,
  submitted_at TEXT, last_error TEXT, screenshot_path TEXT, notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
  is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS application_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, status_from TEXT, status_to TEXT, message TEXT, payload TEXT,
  screenshot_path TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER IF NOT EXISTS applications_updated_at AFTER UPDATE ON applications FOR EACH ROW BEGIN
  UPDATE applications SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS jobs_updated_at AFTER UPDATE ON jobs FOR EACH ROW BEGIN
  UPDATE jobs SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS tasks_updated_at AFTER UPDATE ON tasks FOR EACH ROW BEGIN
  UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS notes_updated_at AFTER UPDATE ON notes FOR EACH ROW BEGIN
  UPDATE notes SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;
CREATE INDEX IF NOT EXISTS idx_jobs_review_status ON jobs(review_status);
CREATE INDEX IF NOT EXISTS idx_jobs_source_category ON jobs(source_category);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_job_id_unique ON applications(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_resume_versions_job_id ON resume_versions(job_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_job_id ON tasks(job_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_jobs_company_role_key ON jobs(company_key, role_key);
CREATE INDEX IF NOT EXISTS idx_jobs_canonical_url ON jobs(canonical_url);
CREATE INDEX IF NOT EXISTS idx_notes_pinned_updated ON notes(is_pinned DESC, updated_at DESC, id DESC);
