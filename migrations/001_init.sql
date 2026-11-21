CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(username) BETWEEN 1 AND 64)
) STRICT;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  CHECK (length(token_hash) = 64),
  CHECK (length(csrf_token) >= 32)
) STRICT;

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_normalized TEXT NOT NULL,
  service_category TEXT,
  service TEXT,
  preferred_date TEXT,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'confirmed', 'completed', 'cancelled')),
  consent_at TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  search_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK (length(name) BETWEEN 2 AND 80),
  CHECK (length(phone) BETWEEN 1 AND 32),
  CHECK (length(phone_normalized) BETWEEN 10 AND 15),
  CHECK (service_category IS NULL OR length(service_category) <= 50),
  CHECK (service IS NULL OR length(service) <= 200),
  CHECK (preferred_date IS NULL OR length(preferred_date) = 10),
  CHECK (comment IS NULL OR length(comment) <= 1000),
  CHECK (length(consent_version) BETWEEN 1 AND 32)
) STRICT;

CREATE INDEX idx_bookings_created_at ON bookings(created_at DESC, id DESC);
CREATE INDEX idx_bookings_status_created ON bookings(status, created_at DESC);
CREATE INDEX idx_bookings_phone ON bookings(phone_normalized, created_at DESC);
CREATE INDEX idx_bookings_expires ON bookings(expires_at);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL,
  CHECK (length(action) BETWEEN 1 AND 64),
  CHECK (length(entity) BETWEEN 1 AND 32)
) STRICT;

CREATE INDEX idx_audit_log_created_at ON audit_log(created_at DESC);
