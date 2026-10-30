
-- Volunteer accounts. Store hashes, not raw access keys.
CREATE TABLE IF NOT EXISTS volunteers (
    id TEXT PRIMARY KEY,
    access_key_hash TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1
);

-- Each source sentence is assigned to one volunteer.
CREATE TABLE IF NOT EXISTS volunteer_assignments (
    volunteer_id TEXT NOT NULL,
    sentence_id INTEGER NOT NULL,
    assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (volunteer_id, sentence_id),
    UNIQUE (sentence_id),
    FOREIGN KEY (volunteer_id) REFERENCES volunteers(id),
    FOREIGN KEY (sentence_id) REFERENCES sentences(id)
);

-- Permanent completion and publication history.
-- This survives deletion of the associated submission.
CREATE TABLE IF NOT EXISTS sentence_progress (
    sentence_id INTEGER PRIMARY KEY,
    volunteer_id TEXT NOT NULL,
    submission_id TEXT,
    status TEXT NOT NULL
        CHECK (status IN ('submitted', 'published', 'needs_review')),
    submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TEXT,
    dataset_revision TEXT,
    FOREIGN KEY (volunteer_id) REFERENCES volunteers(id),
    FOREIGN KEY (sentence_id) REFERENCES sentences(id)
);

-- History of successful dataset publication batches.
CREATE TABLE IF NOT EXISTS publication_batches (
    id TEXT PRIMARY KEY,
    dataset_revision TEXT NOT NULL,
    published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    record_count INTEGER NOT NULL DEFAULT 0
);
