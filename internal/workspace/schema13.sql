CREATE TABLE translation_connections (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 base_url TEXT NOT NULL,
 secret BLOB NOT NULL DEFAULT X'',
 revision INTEGER NOT NULL DEFAULT 1
);
PRAGMA user_version=13;
