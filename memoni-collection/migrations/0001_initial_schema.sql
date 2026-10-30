
CREATE TABLE sentences (
  id INTEGER PRIMARY KEY,
  source_urdu TEXT NOT NULL,
  position INTEGER NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  sentence_id INTEGER NOT NULL,
  contributor_id TEXT NOT NULL,
  romanized_memoni TEXT NOT NULL,
  audio_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (sentence_id, contributor_id),
  FOREIGN KEY (sentence_id) REFERENCES sentences(id)
);

CREATE INDEX idx_submissions_contributor
ON submissions(contributor_id);

CREATE INDEX idx_submissions_sentence
ON submissions(sentence_id);
