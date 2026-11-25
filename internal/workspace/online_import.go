package workspace

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/net/html"
)

type ImportCandidate struct {
	Title    string `json:"title"`
	Journal  string `json:"journal,omitempty"`
	Abstract string `json:"abstract,omitempty"`
	Authors  string `json:"authors"`
	DOI      string `json:"doi"`
	Year     int    `json:"year"`
	Source   string `json:"source"`
	PDF      string `json:"pdf"`
}

var arxivPattern = regexp.MustCompile(`(?i)^(?:[0-9]{4}\.[0-9]{4,5}|[a-z][a-z.\-]*/[0-9]{7})(?:v[1-9][0-9]*)?$`)
var doiPattern = regexp.MustCompile(`(?i)^10\.[0-9]{4,9}/\S+$`)
var reserved = []netip.Prefix{netip.MustParsePrefix("100.64.0.0/10"), netip.MustParsePrefix("198.18.0.0/15"), netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("240.0.0.0/4")}

func allowedIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	for _, prefix := range reserved {
		if prefix.Contains(ip) {
			return false
		}
	}
	return true
}
func publicURL(u *url.URL) bool {
	if u == nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || (u.Port() != "" && u.Port() != "443") {
		return false
	}
	if ip, err := netip.ParseAddr(u.Hostname()); err == nil {
		return allowedIP(ip)
	}
	return strings.Contains(u.Hostname(), ".") && !strings.HasSuffix(strings.ToLower(strings.TrimSuffix(u.Hostname(), ".")), ".local")
}

var publicImportClient = &http.Client{
	Timeout: 100 * time.Second,
	Transport: &http.Transport{
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
			if err != nil {
				return nil, err
			}
			if len(ips) == 0 {
				return nil, errors.New("empty DNS result")
			}
			for _, ip := range ips {
				if !allowedIP(ip) {
					return nil, errors.New("non-public DNS address")
				}
			}
			d := net.Dialer{Timeout: 8 * time.Second}
			for _, ip := range ips {
				conn, err := d.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
				if err == nil {
					return conn, nil
				}
			}
			return nil, errors.New("public host connection failed")
		},
		ForceAttemptHTTP2: true, TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 18 * time.Second,
	},
	CheckRedirect: func(r *http.Request, via []*http.Request) error {
		if len(via) >= 6 || !publicURL(r.URL) {
			return errors.New("unsupported redirect")
		}
		return nil
	},
}
var scholarlyClient = &http.Client{Timeout: 25 * time.Second, CheckRedirect: func(r *http.Request, via []*http.Request) error {
	if len(via) > 3 || r.URL.Scheme != "https" || r.URL.Host != via[0].URL.Host {
		return errors.New("metadata redirect rejected")
	}
	return nil
}}

func paperClient(raw string) *http.Client {
	u, _ := url.Parse(raw)
	if publicURL(u) {
		switch strings.ToLower(u.Hostname()) {
		case "arxiv.org", "www.arxiv.org", "export.arxiv.org", "openreview.net", "proceedings.mlr.press", "aclanthology.org":
			// These named publishers may use the user's system proxy. Redirects
			// remain on the same HTTPS host. Other domains use pinned public DNS.
			copy := *scholarlyClient
			copy.Timeout = 100 * time.Second
			return &copy
		}
	}
	return publicImportClient
}
func fetchImport(ctx context.Context, client *http.Client, raw string) (*http.Response, error) {
	u, err := url.Parse(raw)
	if err != nil || !publicURL(u) {
		return nil, errors.New("请使用公开的 HTTPS 论文或 PDF 链接")
	}
	req, err := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "ResearchDesk-Next/0.2 (desktop scholarly import)")
	resp, err := client.Do(req)
	if err != nil {
		return nil, errors.New("无法连接论文来源，请核对链接或选择本地 PDF")
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, errors.New("论文来源返回 " + strconv.Itoa(resp.StatusCode) + "，可改用本地 PDF")
	}
	return resp, nil
}

func (w *Workspace) lookupOnline(rw http.ResponseWriter, r *http.Request) {
	var input struct {
		Query string `json:"query"`
	}
	if !readJSON(rw, r, 12000, &input) {
		return
	}
	q := strings.TrimSpace(input.Query)
	if q == "" || len(q) > 4000 {
		fail(rw, 400, "请输入论文编号、标题或链接")
		return
	}
	rows, err := resolveImport(r.Context(), q)
	if err != nil {
		fail(rw, 422, err.Error())
		return
	}
	respond(rw, 200, rows)
}
func resolveImport(ctx context.Context, q string) ([]ImportCandidate, error) {
	id := q
	if strings.HasPrefix(strings.ToLower(q), "arxiv:") {
		id = strings.TrimSpace(q[6:])
	}
	doi := q
	if strings.HasPrefix(strings.ToLower(q), "doi:") {
		doi = strings.TrimSpace(q[4:])
	}
	u, err := url.Parse(q)
	if err == nil && u.Scheme != "" && u.Host != "" {
		if !publicURL(u) {
			return nil, errors.New("请使用公开的 HTTPS 链接")
		}
		host := strings.ToLower(u.Hostname())
		if host == "arxiv.org" || host == "www.arxiv.org" || host == "export.arxiv.org" {
			for _, prefix := range []string{"/abs/", "/pdf/", "/html/"} {
				if strings.HasPrefix(u.Path, prefix) {
					id = strings.TrimSuffix(strings.TrimPrefix(u.Path, prefix), ".pdf")
				}
			}
		}
		if host == "doi.org" || host == "dx.doi.org" {
			doi = strings.TrimPrefix(u.Path, "/")
		}
		if !arxivPattern.MatchString(id) && !doiPattern.MatchString(doi) {
			candidate, err := metadataPage(ctx, u.String())
			if err != nil {
				return nil, err
			}
			return []ImportCandidate{candidate}, nil
		}
	}
	if arxivPattern.MatchString(id) {
		return lookupArxiv(ctx, id)
	}
	if doiPattern.MatchString(doi) {
		if strings.HasPrefix(strings.ToLower(doi), "10.48550/arxiv.") {
			key := doi[len("10.48550/arxiv."):]
			if arxivPattern.MatchString(key) {
				return lookupArxiv(ctx, key)
			}
		}
		return lookupCrossref(ctx, doi, true)
	}
	if strings.Contains(q, "://") {
		return nil, errors.New("论文链接格式无效")
	}
	return lookupTitle(ctx, q)
}
func lookupArxiv(ctx context.Context, id string) ([]ImportCandidate, error) {
	// The canonical abstract page carries citation metadata and the official PDF.
	c, err := metadataPage(ctx, "https://arxiv.org/abs/"+id)
	if err == nil && c.Title != "" {
		c.Source = "https://arxiv.org/abs/" + id
		c.PDF = "https://arxiv.org/pdf/" + id
		return []ImportCandidate{c}, nil
	}
	return arxivFeed(ctx, "id_list="+url.QueryEscape(id), id)
}

var arxivVersion = regexp.MustCompile(`(?i)v[1-9][0-9]*$`)

func arxivFeed(ctx context.Context, query, expected string) ([]ImportCandidate, error) {
	resp, err := fetchImport(ctx, scholarlyClient, "https://export.arxiv.org/api/query?"+query)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var feed struct {
		Entries []struct {
			ID        string `xml:"id"`
			Title     string `xml:"title"`
			Published string `xml:"published"`
			DOI       string `xml:"doi"`
			Authors   []struct {
				Name string `xml:"name"`
			} `xml:"author"`
		} `xml:"entry"`
	}
	if xml.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&feed) != nil {
		return nil, errors.New("无法读取 arXiv 元数据")
	}
	found := []ImportCandidate{}
	for _, item := range feed.Entries {
		actual := strings.TrimPrefix(strings.TrimPrefix(item.ID, "http://arxiv.org/abs/"), "https://arxiv.org/abs/")
		if !arxivPattern.MatchString(actual) || strings.TrimSpace(item.Title) == "" {
			continue
		}
		key := actual
		if expected != "" {
			key = expected
			match := strings.EqualFold(actual, expected)
			if !arxivVersion.MatchString(expected) {
				match = strings.EqualFold(arxivVersion.ReplaceAllString(actual, ""), expected)
			}
			if !match {
				continue
			}
		}
		c := ImportCandidate{Title: cleanOnline(item.Title, 900), DOI: cleanOnline(item.DOI, 512), Source: "https://arxiv.org/abs/" + key, PDF: "https://arxiv.org/pdf/" + key, Year: onlineYear(item.Published)}
		var authors []string
		for _, author := range item.Authors {
			authors = append(authors, author.Name)
		}
		c.Authors = cleanOnline(strings.Join(authors, ", "), 4000)
		found = append(found, c)
	}
	if expected != "" && len(found) != 1 {
		return nil, errors.New("没有找到匹配的 arXiv 编号")
	}
	return found, nil
}

func lookupTitle(ctx context.Context, query string) ([]ImportCandidate, error) {
	type result struct {
		rows []ImportCandidate
		err  error
	}
	arxiv := make(chan result, 1)
	search, cancel := context.WithTimeout(ctx, 7*time.Second)
	defer cancel()
	go func() {
		title := strings.ReplaceAll(query, "\"", " ")
		rows, err := arxivFeed(search, "max_results=4&search_query="+url.QueryEscape("ti:\""+title+"\""), "")
		arxiv <- result{rows, err}
	}()
	works, err := lookupCrossref(ctx, query, false)
	optional := <-arxiv
	if err != nil && optional.err != nil {
		return nil, err
	}
	return append(append([]ImportCandidate{}, optional.rows...), works...), nil
}

func lookupCrossref(ctx context.Context, query string, exact bool) ([]ImportCandidate, error) {
	link := "https://api.crossref.org/works?rows=5&query.title=" + url.QueryEscape(query)
	if exact {
		link = "https://api.crossref.org/works/" + url.PathEscape(query)
	}
	resp, err := fetchImport(ctx, scholarlyClient, link)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var body struct {
		Message json.RawMessage `json:"message"`
	}
	if err = json.NewDecoder(io.LimitReader(resp.Body, 5<<20)).Decode(&body); err != nil {
		return nil, errors.New("无法读取 Crossref 返回的文献")
	}
	type work struct {
		ContainerTitle []string `json:"container-title"`
		Abstract       string
		Title          []string
		DOI            string
		URL            string
		Author         []struct {
			Given  string
			Family string
			Name   string
		}
		Published struct {
			Parts [][]int `json:"date-parts"`
		}
		Link []struct {
			URL  string
			Type string `json:"content-type"`
		}
	}
	var list struct{ Items []work }
	if exact {
		var item work
		err = json.Unmarshal(body.Message, &item)
		list.Items = []work{item}
	} else {
		err = json.Unmarshal(body.Message, &list)
	}
	if err != nil {
		return nil, errors.New("Crossref 结果无效")
	}
	candidates := []ImportCandidate{}
	for _, item := range list.Items {
		if len(item.Title) == 0 || strings.TrimSpace(item.Title[0]) == "" {
			continue
		}
		c := ImportCandidate{Title: cleanOnline(item.Title[0], 900), DOI: cleanOnline(item.DOI, 512), Source: item.URL}
		if len(item.ContainerTitle) > 0 {
			c.Journal = cleanOnline(item.ContainerTitle[0], 500)
		}
		c.Abstract = cleanOnline(regexp.MustCompile(`<[^>]*>`).ReplaceAllString(item.Abstract, " "), 12000)
		if len(item.Published.Parts) > 0 && len(item.Published.Parts[0]) > 0 {
			c.Year = item.Published.Parts[0][0]
		}
		authors := []string{}
		for _, a := range item.Author {
			name := strings.TrimSpace(a.Given + " " + a.Family)
			if name == "" {
				name = a.Name
			}
			if name != "" {
				authors = append(authors, name)
			}
		}
		c.Authors = cleanOnline(strings.Join(authors, ", "), 4000)
		for _, l := range item.Link {
			u, _ := url.Parse(l.URL)
			if strings.Contains(strings.ToLower(l.Type), "pdf") && publicURL(u) {
				c.PDF = l.URL
				break
			}
		}
		if strings.HasPrefix(strings.ToLower(c.DOI), "10.48550/arxiv.") {
			id := c.DOI[len("10.48550/arxiv."):]
			if arxivPattern.MatchString(id) {
				c.PDF = "https://arxiv.org/pdf/" + id
			}
		}
		if exact && c.PDF == "" && c.Source != "" {
			if page, err := metadataPage(ctx, c.Source); err == nil {
				c.PDF = page.PDF
			}
		}
		candidates = append(candidates, c)
	}
	return candidates, nil
}
func cleanOnline(raw string, limit int) string {
	value := strings.Join(strings.Fields(raw), " ")
	if len(value) > limit {
		value = value[:limit]
		for !utf8.ValidString(value) {
			value = value[:len(value)-1]
		}
	}
	return value
}
func onlineYear(s string) int {
	if len(s) < 4 {
		return 0
	}
	y, _ := strconv.Atoi(s[:4])
	return y
}
func metadataPage(ctx context.Context, raw string) (ImportCandidate, error) {
	resp, err := fetchImport(ctx, paperClient(raw), raw)
	if err != nil {
		return ImportCandidate{}, err
	}
	defer resp.Body.Close()
	from := resp.Request.URL
	reader := bufio.NewReader(resp.Body)
	signature, _ := reader.Peek(5)
	if bytes.Equal(signature, []byte("%PDF-")) {
		name := strings.TrimSuffix(path.Base(from.Path), path.Ext(from.Path))
		if name == "" || name == "." || name == "/" {
			name = "在线论文"
		}
		return ImportCandidate{Title: cleanOnline(name, 900), Source: from.String(), PDF: from.String()}, nil
	}
	candidate := ImportCandidate{Source: from.String()}
	authors := []string{}
	parser := html.NewTokenizer(io.LimitReader(reader, 3<<20))
	for {
		kind := parser.Next()
		if kind == html.ErrorToken {
			break
		}
		token := parser.Token()
		if kind == html.EndTagToken && token.Data == "head" {
			break
		}
		if (kind != html.StartTagToken && kind != html.SelfClosingTagToken) || token.Data != "meta" {
			continue
		}
		attrs := map[string]string{}
		for _, a := range token.Attr {
			attrs[a.Key] = a.Val
		}
		name := strings.ToLower(attrs["name"])
		if name == "" {
			name = strings.ToLower(attrs["property"])
		}
		content := attrs["content"]
		switch name {
		case "citation_title", "dc.title", "og:title":
			if candidate.Title == "" || name == "citation_title" {
				candidate.Title = cleanOnline(content, 900)
			}
		case "citation_journal_title":
			candidate.Journal = cleanOnline(content, 500)
		case "description", "og:description":
			if candidate.Abstract == "" {
				candidate.Abstract = cleanOnline(content, 12000)
			}
		case "citation_author":
			authors = append(authors, content)
		case "citation_doi":
			candidate.DOI = cleanOnline(content, 512)
		case "citation_publication_date", "citation_date":
			candidate.Year = onlineYear(content)
		case "citation_pdf_url", "eprints.document_url":
			next, err := from.Parse(content)
			if err == nil && publicURL(next) {
				candidate.PDF = next.String()
			}
		}
	}
	candidate.Authors = cleanOnline(strings.Join(authors, ", "), 4000)
	if candidate.Title == "" && candidate.PDF == "" {
		return ImportCandidate{}, errors.New("网页未提供可识别的论文信息或 PDF，请选择本地文件")
	}
	if candidate.Title == "" {
		candidate.Title = "在线论文"
	}
	return candidate, nil
}

func (w *Workspace) importOnline(rw http.ResponseWriter, r *http.Request) {
	var candidate ImportCandidate
	if !readJSON(rw, r, 24<<10, &candidate) {
		return
	}
	if candidate.PDF == "" {
		fail(rw, 422, "该条目没有公开 PDF，请下载后选择本地文件")
		return
	}
	candidate.Title = cleanOnline(candidate.Title, 900)
	candidate.Authors = cleanOnline(candidate.Authors, 4000)
	candidate.DOI = cleanOnline(candidate.DOI, 512)
	if candidate.Year < 0 || candidate.Year > 9999 {
		candidate.Year = 0
	}
	resp, err := fetchImport(r.Context(), paperClient(candidate.PDF), candidate.PDF)
	if err != nil {
		fail(rw, 422, err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.ContentLength > maxPDF {
		fail(rw, 413, "单份 PDF 最大支持 200 MiB")
		return
	}
	if candidate.Title == "" {
		candidate.Title = "在线论文"
	}
	request := r.Clone(r.Context())
	request.Body = resp.Body
	w.persistPaper(rw, request, candidate)
}
