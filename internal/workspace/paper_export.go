package workspace

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/xml"
	"fmt"
	"html"
	"image/png"
	"net/http"
	"regexp"
	"strings"
	"time"
)

type exportReader interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}
type ExportSnapshot struct {
	Paper      Paper       `json:"paper"`
	Plan       ReadingPlan `json:"plan"`
	Marks      []Mark      `json:"marks"`
	SavedAt    string      `json:"savedAt"`
	Translated int         `json:"translated"`
	Pending    int         `json:"pending"`
}
type ExportAsset struct {
	ID  string `json:"id"`
	PNG string `json:"png"`
}
type ExportRender struct {
	Snapshot            ExportSnapshot `json:"snapshot"`
	Assets              []ExportAsset  `json:"assets"`
	IncludeUntranslated bool           `json:"includeUntranslated"`
	AssetPrefix         string         `json:"assetPrefix"`
}

func (w *Workspace) exportSnapshot(rw http.ResponseWriter, r *http.Request) {
	tx, err := w.db.BeginTx(r.Context(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		databaseError(rw, err)
		return
	}
	defer tx.Rollback()
	paper, err := scanPaper(tx.QueryRowContext(r.Context(), paperSelect+" WHERE p.id=? AND p.deleted_at IS NULL", r.PathValue("id")))
	if err != nil {
		databaseError(rw, err)
		return
	}
	plan, _, err := readReadingPlanFrom(r.Context(), tx, paper.ID)
	if err != nil {
		databaseError(rw, err)
		return
	}
	marks, err := readMarksFrom(r.Context(), tx, paper.ID)
	if err != nil {
		databaseError(rw, err)
		return
	}
	snapshot := ExportSnapshot{Paper: paper, Plan: plan, Marks: marks, SavedAt: time.Now().Format(time.RFC3339)}
	for _, g := range plan.Groups {
		if g.Translate {
			if g.Translation != "" {
				snapshot.Translated++
			} else {
				snapshot.Pending++
			}
		}
	}
	if err = tx.Commit(); err != nil {
		databaseError(rw, err)
		return
	}
	respond(rw, 200, snapshot)
}

type exportImage struct {
	raw           []byte
	width, height int
	name          string
}

func exportImages(input ExportRender) (map[string]exportImage, error) {
	if len(input.Assets) > 1500 || len(input.Snapshot.Plan.Groups) > 100000 {
		return nil, fmt.Errorf("导出内容过多，请缩小资料范围")
	}
	needed := map[string]bool{}
	for _, g := range input.Snapshot.Plan.Groups {
		if len(g.Regions) > 0 && exportVisual(g.Regions[0].Kind) {
			needed[g.ID] = true
		}
	}
	images := map[string]exportImage{}
	total := 0
	for _, asset := range input.Assets {
		if !needed[asset.ID] || images[asset.ID].raw != nil {
			return nil, fmt.Errorf("导出图片与段落不匹配")
		}
		raw, err := base64.StdEncoding.DecodeString(asset.PNG)
		if err != nil {
			return nil, fmt.Errorf("导出图片格式无效")
		}
		total += len(raw)
		if total > 96<<20 {
			return nil, fmt.Errorf("导出图片超过96MiB，请减少图片分辨率后重试")
		}
		config, err := png.DecodeConfig(bytes.NewReader(raw))
		if err != nil || config.Width < 1 || config.Height < 1 || config.Width*config.Height > 20000000 {
			return nil, fmt.Errorf("导出图片尺寸无效")
		}
		images[asset.ID] = exportImage{raw: raw, width: config.Width, height: config.Height, name: fmt.Sprintf("image-%03d.png", len(images)+1)}
	}
	if len(images) != len(needed) {
		return nil, fmt.Errorf("图表或公式图片尚未准备完整，未导出")
	}
	return images, nil
}
func exportVisual(kind string) bool { return kind == "figure" || kind == "table" || kind == "formula" }
func exportText(g ReadingGroup, include bool) (string, error) {
	if g.Translate {
		if g.Translation != "" {
			return g.Translation, nil
		}
		if !include {
			return "", fmt.Errorf("还有未翻译段落，请先完成翻译，或明确选择导出当前进度")
		}
		return "【未翻译，保留原文】\n" + g.Text, nil
	}
	return g.Text, nil
}
func exportGroup(g ReadingGroup) bool {
	return len(g.Regions) > 0 && (g.Regions[0].Kind != "margin" || g.Translate)
}

var scripts = regexp.MustCompile(`([_^])\{([^{}\n]{1,30})\}`)

func scientificHTML(text string) string {
	var out strings.Builder
	last := 0
	for _, m := range scripts.FindAllStringSubmatchIndex(text, -1) {
		out.WriteString(html.EscapeString(text[last:m[0]]))
		tag := "sub"
		if text[m[2]:m[3]] == "^" {
			tag = "sup"
		}
		out.WriteString("<" + tag + ">" + html.EscapeString(text[m[4]:m[5]]) + "</" + tag + ">")
		last = m[1]
	}
	out.WriteString(html.EscapeString(text[last:]))
	return out.String()
}
func exportHTML(input ExportRender, images map[string]exportImage) (string, error) {
	var b strings.Builder
	b.WriteString(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src rdnext:"><title>` + html.EscapeString(input.Snapshot.Paper.Title) + `</title><style>
 @font-face{font-family:"ResearchDesk Export";src:url("rdnext://workspace/export-font.otf")} @page{size:A4;margin:20mm 19mm 21mm}*{box-sizing:border-box}body{margin:0;color:#242424;background:white;font:11.5pt/1.75 "ResearchDesk Export","Microsoft YaHei","SimSun",serif;overflow-wrap:anywhere}
 .provenance{font:8pt/1.6 "ResearchDesk Export",sans-serif;color:#666;border-bottom:1px solid #ddd;padding-bottom:7pt;margin-bottom:16pt}
 h1{font-size:21pt;line-height:1.4;margin:0 0 14pt;break-after:avoid}h2{font-size:15pt;line-height:1.5;margin:17pt 0 8pt;break-after:avoid}
 p{margin:0 0 8pt;white-space:pre-wrap;orphans:3;widows:3}p.text{text-indent:2em}p.author{font-size:9pt;color:#555}p.caption{font-size:9.5pt;line-height:1.6;break-before:avoid}p.reference{font-size:9pt;line-height:1.6}
 figure{margin:10pt 0;break-inside:avoid;text-align:center}figure img{max-width:100%;max-height:225mm;width:auto;height:auto}sub,sup{font-size:.72em}
 .incomplete{padding:9pt;border:1px solid #b98540;background:#fff8e8;margin-bottom:14pt}
 </style></head><body>`)
	b.WriteString(`<div class="provenance">原论文：` + html.EscapeString(input.Snapshot.Paper.Title))
	if input.Snapshot.Paper.DOI != "" {
		b.WriteString(" · DOI：" + html.EscapeString(input.Snapshot.Paper.DOI))
	}
	if input.Snapshot.Paper.Metadata.Arxiv != "" {
		b.WriteString(" · arXiv：" + html.EscapeString(input.Snapshot.Paper.Metadata.Arxiv))
	}
	b.WriteString(" · 导出保存快照：" + html.EscapeString(input.Snapshot.SavedAt) + "</div>")
	if input.IncludeUntranslated && input.Snapshot.Pending > 0 {
		b.WriteString(`<div class="incomplete">当前进度导出：尚有 ` + fmt.Sprint(input.Snapshot.Pending) + " 段未翻译，已明确标记并保留原文。</div>")
	}
	for _, g := range input.Snapshot.Plan.Groups {
		if !exportGroup(g) {
			continue
		}
		kind := g.Regions[0].Kind
		if exportVisual(kind) {
			img := images[g.ID]
			b.WriteString(`<figure><img alt="` + html.EscapeString(kind) + `" src="data:image/png;base64,` + base64.StdEncoding.EncodeToString(img.raw) + `"></figure>`)
			continue
		}
		text, err := exportText(g, input.IncludeUntranslated)
		if err != nil {
			return "", err
		}
		if strings.TrimSpace(text) == "" {
			continue
		}
		tag := "p"
		if kind == "title" {
			tag = "h1"
		} else if kind == "heading" {
			tag = "h2"
		}
		b.WriteString("<" + tag + ` class="` + kind + `">` + scientificHTML(text) + "</" + tag + ">")
	}
	b.WriteString("</body></html>")
	return b.String(), nil
}
func exportMarkdown(input ExportRender, images map[string]exportImage) (string, error) {
	if !regexp.MustCompile(`^[A-Za-z0-9_-]{1,100}$`).MatchString(input.AssetPrefix) {
		return "", fmt.Errorf("图片文件夹名称无效")
	}
	var b strings.Builder
	b.WriteString("> 原论文：" + strings.ReplaceAll(input.Snapshot.Paper.Title, "\n", " ") + "\n> 保存快照：" + input.Snapshot.SavedAt + "\n\n")
	if input.IncludeUntranslated && input.Snapshot.Pending > 0 {
		fmt.Fprintf(&b, "> 当前进度：%d 段未翻译，已标记并保留原文。\n\n", input.Snapshot.Pending)
	}
	for _, g := range input.Snapshot.Plan.Groups {
		if !exportGroup(g) {
			continue
		}
		kind := g.Regions[0].Kind
		if exportVisual(kind) {
			fmt.Fprintf(&b, "![%s](./%s/%s)\n\n", kind, input.AssetPrefix, images[g.ID].name)
			continue
		}
		text, err := exportText(g, input.IncludeUntranslated)
		if err != nil {
			return "", err
		}
		if strings.TrimSpace(text) == "" {
			continue
		}
		prefix := ""
		if kind == "title" {
			prefix = "# "
		} else if kind == "heading" {
			prefix = "## "
		}
		// HTML escaping preserves scientific scripts and prevents source text from becoming active HTML.
		b.WriteString(prefix + scientificHTML(text) + "\n\n")
	}
	return b.String(), nil
}
func xmlText(s string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}
func wordRuns(text string) string {
	var b strings.Builder
	last := 0
	run := func(s, align string) {
		if s == "" {
			return
		}
		properties := ""
		if align != "" {
			properties = "<w:rPr><w:vertAlign w:val=\"" + align + "\"/></w:rPr>"
		}
		for i, line := range strings.Split(s, "\n") {
			if i > 0 {
				b.WriteString("<w:r><w:br/></w:r>")
			}
			b.WriteString("<w:r>" + properties + "<w:t xml:space=\"preserve\">" + xmlText(line) + "</w:t></w:r>")
		}
	}
	for _, m := range scripts.FindAllStringSubmatchIndex(text, -1) {
		run(text[last:m[0]], "")
		align := "subscript"
		if text[m[2]:m[3]] == "^" {
			align = "superscript"
		}
		run(text[m[4]:m[5]], align)
		last = m[1]
	}
	run(text[last:], "")
	return b.String()
}
func exportDOCX(input ExportRender, images map[string]exportImage) ([]byte, error) {
	var body, rels strings.Builder
	rels.WriteString(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`)
	body.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>`)
	p := func(text, style string) {
		body.WriteString("<w:p><w:pPr><w:pStyle w:val=\"" + style + "\"/></w:pPr>" + wordRuns(text) + "</w:p>")
	}
	p("原论文："+input.Snapshot.Paper.Title+"\n导出保存快照："+input.Snapshot.SavedAt, "Metadata")
	if input.IncludeUntranslated && input.Snapshot.Pending > 0 {
		p(fmt.Sprintf("当前进度：%d 段未翻译，已标记并保留原文。", input.Snapshot.Pending), "Metadata")
	}
	n := 0
	for _, g := range input.Snapshot.Plan.Groups {
		if !exportGroup(g) {
			continue
		}
		kind := g.Regions[0].Kind
		if exportVisual(kind) {
			n++
			img := images[g.ID]
			cx, cy := int64(5715000), int64(float64(img.height)/float64(img.width)*5715000)
			if cy > 6858000 {
				cx = int64(float64(cx) * 6858000 / float64(cy))
				cy = 6858000
			}
			id := fmt.Sprintf("image%d", n)
			rels.WriteString(`<Relationship Id="` + id + `" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/` + img.name + `"/>`)
			fmt.Fprintf(&body, `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="%d" cy="%d"/><wp:docPr id="%d" name="%s"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="%d" name="%s"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="%s"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="%d" cy="%d"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`, cx, cy, n, kind, n, kind, id, cx, cy)
			continue
		}
		text, err := exportText(g, input.IncludeUntranslated)
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(text) == "" {
			continue
		}
		style := "Normal"
		switch kind {
		case "title":
			style = "Title"
		case "heading":
			style = "Heading1"
		case "text":
			style = "Body"
		case "author", "caption", "reference", "formula-number":
			style = "Caption"
		}
		p(text, style)
	}
	body.WriteString(`<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1077" w:bottom="1191" w:left="1077" w:header="500" w:footer="500"/></w:sectPr></w:body></w:document>`)
	rels.WriteString("</Relationships>")
	styles := `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
 <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体"/><w:sz w:val="23"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults>
 <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
 <w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Body Text"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:firstLine="460"/></w:pPr></w:style>
 <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:after="280"/></w:pPr><w:rPr><w:b/><w:sz w:val="42"/></w:rPr></w:style>
 <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="300" w:after="140"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
 <w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="19"/></w:rPr></w:style>
 <w:style w:type="paragraph" w:styleId="Metadata"><w:name w:val="Metadata"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="666666"/><w:sz w:val="17"/></w:rPr></w:style></w:styles>`
	content := `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`
	var out bytes.Buffer
	z := zip.NewWriter(&out)
	files := map[string][]byte{"[Content_Types].xml": []byte(content), "_rels/.rels": []byte(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`), "word/document.xml": []byte(body.String()), "word/styles.xml": []byte(styles), "word/_rels/document.xml.rels": []byte(rels.String())}
	for _, img := range images {
		files["word/media/"+img.name] = img.raw
	}
	for name, raw := range files {
		f, err := z.Create(name)
		if err != nil {
			return nil, err
		}
		if _, err = f.Write(raw); err != nil {
			return nil, err
		}
	}
	if err := z.Close(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}
func (w *Workspace) renderExport(rw http.ResponseWriter, r *http.Request) {
	var input ExportRender
	if !readJSON(rw, r, 150<<20, &input) {
		return
	}
	if !validID(input.Snapshot.Paper.ID, 64) || input.Snapshot.Paper.Deleted || input.Snapshot.Translated < 1 {
		fail(rw, 400, "这篇论文暂时没有可导出的已保存译文")
		return
	}
	images, err := exportImages(input)
	if err != nil {
		fail(rw, 400, err.Error())
		return
	}
	format := r.PathValue("format")
	var raw []byte
	mime := "text/plain; charset=utf-8"
	switch format {
	case "html":
		var text string
		text, err = exportHTML(input, images)
		raw = []byte(text)
		mime = "text/html; charset=utf-8"
	case "markdown":
		var text string
		text, err = exportMarkdown(input, images)
		raw = []byte(text)
		mime = "text/markdown; charset=utf-8"
	case "docx":
		raw, err = exportDOCX(input, images)
		mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	default:
		fail(rw, 404, "不支持的导出格式")
		return
	}
	if err != nil {
		fail(rw, 409, err.Error())
		return
	}
	rw.Header().Set("Content-Type", mime)
	rw.WriteHeader(200)
	_, _ = rw.Write(raw)
}
