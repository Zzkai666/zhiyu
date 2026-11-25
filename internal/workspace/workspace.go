package workspace

import (
	"crypto/rand"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/gofrs/flock"
	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schema string

//go:embed schema2.sql
var schema2 string

//go:embed schema3.sql
var schema3 string

//go:embed schema4.sql
var schema4 string

//go:embed schema5.sql
var schema5 string

//go:embed schema6.sql
var schema6 string

const applicationID = 1380208210

//go:embed schema7.sql
var schema7 string

//go:embed schema8.sql
var schema8 string

//go:embed schema9.sql
var schema9 string

//go:embed schema10.sql
var schema10 string

//go:embed schema11.sql
var schema11 string

//go:embed schema12.sql
var schema12 string

//go:embed schema13.sql
var schema13 string

const schemaVersion = 13
const maxPDF = 200 << 20

type Workspace struct {
	root            string
	db              *sql.DB
	lock            *flock.Flock
	importLock      sync.Mutex
	readerLock      sync.Mutex
	translationLock sync.Mutex
	jobLock         sync.Mutex
	focusLock       sync.Mutex
	focusStop       chan struct{}
	focusStopped    chan struct{}
	closeOnce       sync.Once
}

func Open(root string) (*Workspace, error) {
	if !filepath.IsAbs(root) {
		return nil, errors.New("workspace path must be absolute")
	}
	for _, name := range []string{"library.sqlite3", "researchdesk.sqlite3", "workspace-format.json", "workspace-format"} {
		if _, err := os.Lstat(filepath.Join(root, name)); !errors.Is(err, os.ErrNotExist) {
			return nil, errors.New("this directory contains a previous workspace format")
		}
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return nil, err
	}
	instance := flock.New(filepath.Join(root, ".next.lock"))
	ok, err := instance.TryLock()
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, errors.New("the workspace is already open")
	}
	w := &Workspace{root: root, lock: instance}
	if err := w.openDB(); err != nil {
		w.Close()
		return nil, err
	}
	w.focusStop = make(chan struct{})
	w.focusStopped = make(chan struct{})
	go w.runFocusClock()
	return w, nil
}

func (w *Workspace) openDB() error {
	var err error
	w.db, err = sql.Open("sqlite", filepath.Join(w.root, "researchdesk-next.sqlite"))
	if err != nil {
		return err
	}
	w.db.SetMaxOpenConns(1)
	var id, version, tables int
	if err := w.db.QueryRow("PRAGMA application_id").Scan(&id); err != nil {
		return err
	}
	if err := w.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if err := w.db.QueryRow("SELECT count(*) FROM sqlite_schema WHERE type='table'").Scan(&tables); err != nil {
		return err
	}
	if !(id == 0 && version == 0 && tables == 0) && (id != applicationID || version < 1 || version > schemaVersion) {
		return fmt.Errorf("unsupported workspace format (%d/%d)", id, version)
	}
	if version < schemaVersion {
		if version > 0 {
			backup := filepath.Join(w.root, fmt.Sprintf("pre-schema%d-%d.sqlite", schemaVersion, time.Now().UnixNano()))
			if _, err := w.db.Exec("VACUUM INTO ?", backup); err != nil {
				return err
			}
		}
		migrations := []string{schema, schema2, schema3, schema4, schema5, schema6, schema7, schema8, schema9, schema10, schema11, schema12, schema13}
		tx, err := w.db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		for _, migration := range migrations[version:] {
			if _, err := tx.Exec(migration); err != nil {
				return err
			}
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	if _, err := w.db.Exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL"); err != nil {
		return err
	}
	if err := w.interruptFocus(); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(w.root, "pdf"), 0700); err != nil {
		return err
	}
	return w.recoverPaperJobs()
}

func (w *Workspace) Close() {
	w.closeOnce.Do(func() {
		if w.focusStop != nil {
			close(w.focusStop)
			<-w.focusStopped
		}
		if w.db != nil {
			_ = w.db.Close()
		}
		_ = w.lock.Close()
	})
}

func now() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
