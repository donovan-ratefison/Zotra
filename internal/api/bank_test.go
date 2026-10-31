package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
)

// bankOf checks status 200 and returns the "bank" object.
func bankOf(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	b, ok := decode(t, rec)["bank"].(map[string]any)
	if !ok {
		t.Fatalf("no bank object: %s", rec.Body.String())
	}
	return b
}

// bankBody builds the JSON body of PUT /api/settings/bank.
func bankBody(name, primary, accent string) string {
	b, _ := json.Marshal(map[string]string{
		"name": name, "primary_color": primary, "accent_color": accent})
	return string(b)
}

// updatedAt parses the updated_at field of a bank object.
func updatedAt(t *testing.T, b map[string]any) time.Time {
	t.Helper()
	s, _ := b["updated_at"].(string)
	at, err := time.Parse(time.RFC3339Nano, s)
	if err != nil || at.IsZero() {
		t.Fatalf("updated_at = %q: %v", s, err)
	}
	return at
}

func TestBankProfile(t *testing.T) {
	newTestAPI(t)

	// G1: the seed row.
	g1 := bankOf(t, do(t, "GET", "/api/settings/bank", "", ""))
	for k, want := range map[string]string{
		"name": "Banque Ravina", "primary_color": "#0f4c45", "accent_color": "#b8913a"} {
		if g1[k] != want {
			t.Errorf("G1 %s = %v, want %q", k, g1[k], want)
		}
	}
	if g1["logo_url"] != nil {
		t.Errorf("G1 logo_url = %v, want null", g1["logo_url"])
	}
	t0 := updatedAt(t, g1)

	// P1: trimmed name, lower-case colors, a later updated_at.
	p1 := bankOf(t, do(t, "PUT", "/api/settings/bank",
		`{"name":"  Banque Test ","primary_color":"#1A2B3C","accent_color":"#ffcc00"}`, ""))
	for k, want := range map[string]string{
		"name": "Banque Test", "primary_color": "#1a2b3c", "accent_color": "#ffcc00"} {
		if p1[k] != want {
			t.Errorf("P1 %s = %v, want %q", k, p1[k], want)
		}
	}
	if p1["logo_url"] != nil {
		t.Errorf("P1 logo_url = %v, want null", p1["logo_url"])
	}
	if !updatedAt(t, p1).After(t0) {
		t.Errorf("P1 updated_at %v is not after %v", p1["updated_at"], t0)
	}
	if got := bankOf(t, do(t, "GET", "/api/settings/bank", "", "")); !reflect.DeepEqual(got, p1) {
		t.Errorf("P1 GET = %v, want %v", got, p1)
	}

	// P2: 80 runes is the upper limit.
	p2 := bankOf(t, do(t, "PUT", "/api/settings/bank",
		bankBody(strings.Repeat("é", 80), "#000000", "#ffffff"), ""))

	const (
		msgRead  = "cannot read the body"
		msgName  = "the name must have 1 to 80 characters"
		msgPrim  = "primary_color must have the form #rrggbb"
		msgAccnt = "accent_color must have the form #rrggbb"
	)
	for _, c := range []struct{ row, body, msg string }{
		{"R1", `{`, msgRead},
		{"R2", bankBody("", "#000000", "#000000"), msgName},
		{"R3", bankBody("   ", "#000000", "#000000"), msgName},
		{"R4", bankBody(strings.Repeat("é", 81), "#000000", "#000000"), msgName},
		{"R5", bankBody("Bank", "#12345", "#000000"), msgPrim},
		{"R6", bankBody("Bank", "red", "#000000"), msgPrim},
		{"R7", bankBody("Bank", "#000000", "#gggggg"), msgAccnt},
		{"R8", bankBody("", "red", "#000000"), msgName},
		{"R10", `{"name":"` + strings.Repeat("a", 70000) +
			`","primary_color":"#000000","accent_color":"#000000"}`, msgRead},
		{"R11", `{"name":null,"primary_color":"#000000","accent_color":"#000000"}`, msgName},
	} {
		t.Run(c.row, func(t *testing.T) {
			checkError(t, do(t, "PUT", "/api/settings/bank", c.body, ""),
				http.StatusBadRequest, "invalid_bank", c.msg)
		})
	}

	// R9: the refused inputs changed nothing.
	if got := bankOf(t, do(t, "GET", "/api/settings/bank", "", "")); !reflect.DeepEqual(got, p2) {
		t.Errorf("R9 GET = %v, want %v", got, p2)
	}
}

func TestBankLogo(t *testing.T) {
	newTestAPI(t)
	const png = "\x89PNG\r\n\x1a\n"
	putLogo := func(body string) *httptest.ResponseRecorder {
		return do(t, "PUT", "/api/settings/bank/logo", body, "")
	}

	// G2: no logo in the seed row.
	checkError(t, do(t, "GET", "/api/settings/bank/logo", "", ""),
		http.StatusNotFound, "not_found", "no logo")

	// L1: a PNG logo keeps the name and the colors.
	before := bankOf(t, do(t, "GET", "/api/settings/bank", "", ""))
	l1 := bankOf(t, putLogo(png+"data"))
	logoURL, _ := l1["logo_url"].(string)
	m := regexp.MustCompile(`^/api/settings/bank/logo\?v=(\d+)$`).FindStringSubmatch(logoURL)
	if m == nil {
		t.Fatalf("L1 logo_url = %v", l1["logo_url"])
	}
	if want := strconv.FormatInt(updatedAt(t, l1).UnixMilli(), 10); m[1] != want {
		t.Errorf("L1 v = %s, want %s", m[1], want)
	}
	for _, k := range []string{"name", "primary_color", "accent_color"} {
		if l1[k] != before[k] {
			t.Errorf("L1 %s = %v, want %v", k, l1[k], before[k])
		}
	}
	rec := do(t, "GET", "/api/settings/bank/logo", "", "")
	if rec.Code != http.StatusOK || rec.Body.String() != png+"data" {
		t.Fatalf("L1 GET logo = %d %q", rec.Code, rec.Body.String())
	}
	for k, want := range map[string]string{
		"Content-Type":            "image/png",
		"Content-Length":          "12",
		"Cache-Control":           "no-store",
		"X-Content-Type-Options":  "nosniff",
		"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
	} {
		if got := rec.Header().Get(k); got != want {
			t.Errorf("L1 header %s = %q, want %q", k, got, want)
		}
	}

	// L2: an SVG logo.
	bankOf(t, putLogo(`<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>`))
	if got := do(t, "GET", "/api/settings/bank/logo", "", "").Header().Get("Content-Type"); got != "image/svg+xml" {
		t.Errorf("L2 Content-Type = %q, want image/svg+xml", got)
	}

	// L3, L4: the size limit is 1 MiB.
	bankOf(t, putLogo(png+string(make([]byte, 1<<20-len(png)))))
	checkError(t, putLogo(png+string(make([]byte, 1<<20+1-len(png)))),
		http.StatusRequestEntityTooLarge, "too_large", "the logo must stay under 1 MiB")

	// L5 to L7.
	checkError(t, putLogo(""), http.StatusBadRequest, "invalid_logo", "the body is empty")
	for _, body := range []string{"GIF89a", "%PDF-1.7"} {
		checkError(t, putLogo(body), http.StatusBadRequest, "invalid_logo",
			"the logo is not a PNG or SVG file")
	}

	// L10: an attribute that only holds "on" is not refused.
	const l10 = `<svg><g data-on="x"/></svg>`
	bankOf(t, putLogo(l10))

	// L8, L9, L12, L13, L14: an SVG with a script is refused.
	for _, body := range []string{
		`<svg><script>alert(1)</script></svg>`,
		`<svg onload="alert(1)"></svg>`,
		`<svg/onload="alert(1)"></svg>`,
		`<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "&#60;script&#62;">]><svg>&x;</svg>`,
		`<svg><a href="javascript:alert(1)"><rect/></a></svg>`,
	} {
		checkError(t, putLogo(body), http.StatusBadRequest, "invalid_logo",
			"the SVG logo holds a script")
	}

	// L11: the refused uploads kept the last good logo.
	if got := do(t, "GET", "/api/settings/bank/logo", "", "").Body.String(); got != l10 {
		t.Errorf("L11 logo = %q, want %q", got, l10)
	}

	// U1: a profile update keeps the logo.
	u1 := bankOf(t, do(t, "PUT", "/api/settings/bank", bankBody("Bank", "#000000", "#ffffff"), ""))
	if u1["logo_url"] == nil {
		t.Errorf("U1 logo_url = null, want the logo URL")
	}
}

func TestLogoMIME(t *testing.T) {
	const (
		svg = "image/svg+xml"
		s   = "the SVG logo holds a script"
		n   = "the logo is not a PNG or SVG file"
	)
	for _, c := range []struct{ row, in, mime, problem string }{
		{"M1", "\x89PNG\r\n\x1a\nrest", "image/png", ""},
		{"M2", `<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`, svg, ""},
		{"M3", "\xef\xbb\xbf\n <?xml version=\"1.0\"?><svg></svg>", svg, ""},
		{"M4", `<svg><SCRIPT>alert(1)</SCRIPT></svg>`, "", s},
		{"M5", `<svg onload="alert(1)"></svg>`, "", s},
		{"M6", "<svg\nOnLoad = 'x'></svg>", "", s},
		{"M7", `<svg><g data-on="x" font="none"/></svg>`, svg, ""},
		{"M8", `GIF89a`, "", n},
		{"M9", `<?xml version="1.0"?><html></html>`, "", n},
		{"M10", `%PDF-1.7`, "", n},
		{"M11", `<svg/onload="alert(1)"></svg>`, "", s},
		{"M12", `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "&#60;script&#62;">]><svg>&x;</svg>`, "", s},
		{"M13", `<svg><a href="javascript:alert(1)"><rect/></a></svg>`, "", s},
	} {
		mime, problem := logoMIME([]byte(c.in))
		if mime != c.mime || problem != c.problem {
			t.Errorf("%s logoMIME(%q) = (%q, %q), want (%q, %q)",
				c.row, c.in, mime, problem, c.mime, c.problem)
		}
	}
}
