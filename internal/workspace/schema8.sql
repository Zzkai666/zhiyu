ALTER TABLE marks ADD COLUMN content TEXT NOT NULL DEFAULT '';
UPDATE marks SET content=comment,comment='' WHERE kind='text';
PRAGMA user_version=8;
