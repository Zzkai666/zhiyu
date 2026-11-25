package workspace

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

type Paper struct {
	ID             string        `json:"id"`
	Title          string        `json:"title"`
	Authors        string        `json:"authors"`
	Year           int           `json:"year"`
	Status         string        `json:"status"`
	Favorite       bool          `json:"favorite"`
	Tags           []string      `json:"tags"`
	DOI            string        `json:"doi"`
	AddedAt        string        `json:"addedAt"`
	Bytes          int64         `json:"bytes"`
	Revision       int           `json:"revision"`
	Deleted        bool          `json:"deleted"`
	Page           int           `json:"page"`
	Zoom           int           `json:"zoom"`
	ReadAt         string        `json:"readAt"`
	Metadata       PaperMetadata `json:"metadata"`
	Filename       string        `json:"filename"`
	TotalPages     int           `json:"totalPages"`
	Remark         string        `json:"remark"`
	RemarkRevision int           `json:"remarkRevision"`
}

const paperSelect = `SELECT p.id,p.title,p.authors,p.year,p.status,p.favorite,p.tags,p.doi,p.added_at,p.bytes,p.revision,
    p.deleted_at IS NOT NULL,coalesce(r.page,1),coalesce(r.zoom,100),coalesce(r.updated_at,''),p.metadata,p.filename,coalesce(e.page_count,0),coalesce(e.remark,''),coalesce(e.remark_revision,0)
    FROM papers p LEFT JOIN positions r ON p.id=r.paper_id LEFT JOIN paper_extras e ON p.id=e.paper_id`

func scanPaper(row interface{ Scan(...any) error }) (Paper, error) {
	var p Paper
	var tags, metadata string
	err := row.Scan(&p.ID, &p.Title, &p.Authors, &p.Year, &p.Status, &p.Favorite, &tags, &p.DOI, &p.AddedAt, &p.Bytes, &p.Revision, &p.Deleted, &p.Page, &p.Zoom, &p.ReadAt, &metadata, &p.Filename, &p.TotalPages, &p.Remark, &p.RemarkRevision)
	if err == nil {
		err = json.Unmarshal([]byte(tags), &p.Tags)
		if err == nil {
			err = json.Unmarshal([]byte(metadata), &p.Metadata)
		}
	}
	return p, err
}

func (w *Workspace) listPapers(rw http.ResponseWriter, r *http.Request) {
	rows, err := w.db.QueryContext(r.Context(), paperSelect+` ORDER BY p.added_at DESC,p.id`)
	if err != nil {
		databaseError(rw, err)
		return
	}
	defer rows.Close()
	papers := []Paper{}
	for rows.Next() {
		p, err := scanPaper(rows)
		if err != nil {
			databaseError(rw, err)
			return
		}
		papers = append(papers, p)
	}
	if err := rows.Err(); err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, papers)
}

func (w *Workspace) paperPath(id string) string { return filepath.Join(w.root, "pdf", id+".pdf") }

func (w *Workspace) importPaper(rw http.ResponseWriter, r *http.Request) {
	title, err := url.PathUnescape(r.Header.Get("X-Paper-Title"))
	title = strings.TrimSpace(strings.TrimSuffix(title, filepath.Ext(title)))
	if err != nil || title == "" || len(title) > 1000 {
		fail(rw, 400, "PDF 文件名无效")
		return
	}
	w.persistPaper(rw, r, ImportCandidate{Title: title})
}

func (w *Workspace) persistPaper(rw http.ResponseWriter, r *http.Request, metadata ImportCandidate) {
	r.Body = http.MaxBytesReader(rw, r.Body, maxPDF)
	source := bufio.NewReader(r.Body)
	prefix, err := source.Peek(5)
	if err != nil || !bytes.Equal(prefix, []byte("%PDF-")) {
		fail(rw, 400, "该文件没有有效的 PDF 文件头")
		return
	}
	temp, err := os.CreateTemp(filepath.Join(w.root, "pdf"), ".import-*.tmp")
	if err != nil {
		databaseError(rw, err)
		return
	}
	defer os.Remove(temp.Name())
	hash := sha256.New()
	size, err := io.Copy(io.MultiWriter(temp, hash), source)
	closeErr := temp.Close()
	if err != nil {
		var maxError *http.MaxBytesError
		if errors.As(err, &maxError) {
			fail(rw, 413, "单份 PDF 最大支持 200 MiB")
			return
		}
		databaseError(rw, err)
		return
	}
	if closeErr != nil {
		databaseError(rw, closeErr)
		return
	}

	id := hex.EncodeToString(hash.Sum(nil))
	w.importLock.Lock()
	defer w.importLock.Unlock()
	p, err := scanPaper(w.db.QueryRowContext(r.Context(), paperSelect+" WHERE p.id=?", id))
	if err == nil {
		if p.Deleted {
			fail(rw, 409, "同一份 PDF 在回收站中，请先恢复")
			return
		}
		if _, err := os.Stat(w.paperPath(id)); errors.Is(err, os.ErrNotExist) {
			if err := os.Rename(temp.Name(), w.paperPath(id)); err != nil {
				databaseError(rw, err)
				return
			}
		} else if err != nil {
			databaseError(rw, err)
			return
		}
		respond(rw, 200, map[string]any{"paper": p, "duplicate": true})
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		databaseError(rw, err)
		return
	}
	if err := os.Rename(temp.Name(), w.paperPath(id)); err != nil {
		databaseError(rw, err)
		return
	}
	timestamp := now()
	initialMetadata := PaperMetadata{}
	if metadata.Source != "" {
		initialMetadata = PaperMetadata{URL: metadata.Source, PDF: metadata.PDF, Journal: metadata.Journal, Abstract: metadata.Abstract, Source: "在线导入", Status: "verified", UpdatedAt: timestamp}
		if hit := embeddedArxiv.FindStringSubmatch(metadata.Source); len(hit) > 1 {
			initialMetadata.Arxiv = hit[1]
		}
	}
	encodedMetadata, _ := json.Marshal(initialMetadata)
	if _, err := w.db.ExecContext(r.Context(), "INSERT INTO papers(id,title,authors,year,doi,bytes,added_at,filename,metadata) VALUES(?,?,?,?,?,?,?,?,?)", id, metadata.Title, metadata.Authors, metadata.Year, metadata.DOI, size, timestamp, metadata.Title, string(encodedMetadata)); err != nil {
		_ = os.Remove(w.paperPath(id))
		databaseError(rw, err)
		return
	}
	respond(rw, 201, map[string]any{"paper": Paper{ID: id, Title: metadata.Title, Authors: metadata.Authors, Year: metadata.Year, DOI: metadata.DOI, Bytes: size, AddedAt: timestamp, Revision: 1, Status: "待阅读", Tags: []string{}, Page: 1, Zoom: 100}, "duplicate": false})
}

func (w *Workspace) pdf(rw http.ResponseWriter, r *http.Request) {
	var id string
	if err := w.db.QueryRowContext(r.Context(), "SELECT id FROM papers WHERE id=? AND deleted_at IS NULL", r.PathValue("id")).Scan(&id); err != nil {
		databaseError(rw, err)
		return
	}
	file, err := os.Open(w.paperPath(id))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			fail(rw, 404, "PDF 文件缺失，请重新导入原文件")
			return
		}
		databaseError(rw, err)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		databaseError(rw, err)
		return
	}
	rw.Header().Set("Content-Type", "application/pdf")
	http.ServeContent(rw, r, "paper.pdf", info.ModTime(), file)
}

func (w *Workspace) updatePaper(rw http.ResponseWriter, r *http.Request) {
	var input struct {
		Title    string   `json:"title"`
		Authors  string   `json:"authors"`
		Year     int      `json:"year"`
		Status   string   `json:"status"`
		Favorite bool     `json:"favorite"`
		Tags     []string `json:"tags"`
		DOI      string   `json:"doi"`
		Revision int      `json:"revision"`
		Deleted  bool     `json:"deleted"`
	}
	if !readJSON(rw, r, 32<<10, &input) {
		return
	}
	input.Title = strings.TrimSpace(input.Title)
	if input.Title == "" || len(input.Title) > 1000 || len(input.Authors) > 4000 || len(input.DOI) > 512 || len(input.Tags) > 40 || input.Year < 0 || input.Year > 9999 ||
		(input.Status != "待阅读" && input.Status != "阅读中" && input.Status != "已读") {
		fail(rw, 400, "文献信息无效")
		return
	}
	unique := map[string]bool{}
	tags := []string{}
	for _, tag := range input.Tags {
		tag = strings.TrimSpace(tag)
		if len(tag) > 200 {
			fail(rw, 400, "标签过长")
			return
		}
		if tag != "" && !unique[tag] {
			tags = append(tags, tag)
			unique[tag] = true
		}
	}
	encoded, _ := json.Marshal(tags)
	var deleted any
	if input.Deleted {
		deleted = now()
	}
	id := r.PathValue("id")
	res, err := w.db.ExecContext(r.Context(), `UPDATE papers SET title=?,authors=?,year=?,status=?,favorite=?,tags=?,doi=?,deleted_at=?,
        revision=revision+1 WHERE id=? AND revision=?`, input.Title, input.Authors, input.Year, input.Status, input.Favorite, string(encoded), input.DOI, deleted, id, input.Revision)
	if err != nil {
		databaseError(rw, err)
		return
	}
	changed, _ := res.RowsAffected()
	if changed != 1 {
		fail(rw, 409, "文献信息已更新，请刷新后再保存")
		return
	}
	p, err := scanPaper(w.db.QueryRowContext(r.Context(), paperSelect+" WHERE p.id=?", id))
	if err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, p)
}

func (w *Workspace) savePosition(rw http.ResponseWriter, r *http.Request) {
	var input struct {
		Page int `json:"page"`
		Zoom int `json:"zoom"`
	}
	if !readJSON(rw, r, 1024, &input) {
		return
	}
	if input.Page < 1 || input.Page > 100000 || input.Zoom < 20 || input.Zoom > 400 {
		fail(rw, 400, "阅读位置无效")
		return
	}
	tx, err := w.db.BeginTx(r.Context(), nil)
	if err != nil {
		databaseError(rw, err)
		return
	}
	defer tx.Rollback()
	id := r.PathValue("id")
	p, err := scanPaper(tx.QueryRowContext(r.Context(), paperSelect+" WHERE p.id=? AND p.deleted_at IS NULL", id))
	if errors.Is(err, sql.ErrNoRows) {
		fail(rw, 404, "文献不可用")
		return
	}
	if err != nil {
		databaseError(rw, err)
		return
	}
	if p.TotalPages > 0 && input.Page > p.TotalPages {
		fail(rw, 400, "阅读页码超出 PDF 范围")
		return
	}
	timestamp := now()
	_, err = tx.ExecContext(r.Context(), `INSERT INTO positions(paper_id,page,zoom,updated_at) VALUES(?,?,?,?)
 ON CONFLICT(paper_id) DO UPDATE SET page=excluded.page,zoom=excluded.zoom,updated_at=excluded.updated_at`, id, input.Page, input.Zoom, timestamp)
	if err != nil {
		databaseError(rw, err)
		return
	}
	if p.Status == "待阅读" {
		if _, err = tx.ExecContext(r.Context(), "UPDATE papers SET status='阅读中',revision=revision+1 WHERE id=? AND status='待阅读'", id); err != nil {
			databaseError(rw, err)
			return
		}
		p.Status = "阅读中"
		p.Revision++
	}
	if err = tx.Commit(); err != nil {
		databaseError(rw, err)
		return
	}
	p.Page = input.Page
	p.Zoom = input.Zoom
	p.ReadAt = timestamp
	respond(rw, 200, p)
}
