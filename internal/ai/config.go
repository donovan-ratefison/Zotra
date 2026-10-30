// Package ai gives the server one HTTP path to the models. It holds
// four transport modes (live, cache, replay, off) and a daily
// budget guard.
package ai

import (
	"os"
	"strconv"
)

// Config is the AI layer configuration, from the environment.
type Config struct {
	BaseURL   string
	APIKey    string
	TextModel string
	SAMModel  string
	Mode      string
	CacheDir  string
	BudgetUSD float64
	// The document calls (SAM zones and field reading). Empty: the
	// text values.
	DocBaseURL string
	DocAPIKey  string
	ReadModel  string
}

// LoadConfig reads one environment variable per field. An empty or
// absent variable keeps the default. An empty document value takes
// the text value.
func LoadConfig() Config {
	cfg := Config{
		BaseURL:   "https://api.meta.ai/v1",
		APIKey:    "",
		TextModel: "muse-spark-1.3",
		SAMModel:  "sam-3.1",
		Mode:      "cache",
		CacheDir:  "local/ai-cache",
		BudgetUSD: 2,
	}
	if v := os.Getenv("ZOTRA_AI_BASE_URL"); v != "" {
		cfg.BaseURL = v
	}
	if v := os.Getenv("ZOTRA_AI_API_KEY"); v != "" {
		cfg.APIKey = v
	}
	if v := os.Getenv("ZOTRA_AI_TEXT_MODEL"); v != "" {
		cfg.TextModel = v
	}
	if v := os.Getenv("ZOTRA_AI_SAM_MODEL"); v != "" {
		cfg.SAMModel = v
	}
	if v := os.Getenv("ZOTRA_AI_MODE"); v == "live" || v == "cache" || v == "replay" || v == "off" {
		cfg.Mode = v
	}
	if v := os.Getenv("ZOTRA_AI_CACHE_DIR"); v != "" {
		cfg.CacheDir = v
	}
	if v := os.Getenv("ZOTRA_AI_BUDGET_USD"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			cfg.BudgetUSD = f
		}
	}
	cfg.DocBaseURL = os.Getenv("ZOTRA_AI_DOC_BASE_URL")
	cfg.DocAPIKey = os.Getenv("ZOTRA_AI_DOC_API_KEY")
	cfg.ReadModel = os.Getenv("ZOTRA_AI_READ_MODEL")
	if cfg.DocBaseURL == "" {
		cfg.DocBaseURL = cfg.BaseURL
	}
	if cfg.DocAPIKey == "" {
		cfg.DocAPIKey = cfg.APIKey
	}
	if cfg.ReadModel == "" {
		cfg.ReadModel = cfg.TextModel
	}
	return cfg
}

// Document returns the configuration of the document calls (SAM
// zones and field reading): the document endpoint and key, with all
// other fields of c.
func (c Config) Document() Config {
	c.BaseURL = c.DocBaseURL
	c.APIKey = c.DocAPIKey
	return c
}

// pricePerMillion returns the USD price per million tokens of one
// model, in and out. An unknown model gets the muse-spark-1.3 prices.
func pricePerMillion(model string) (in, out float64) {
	switch model {
	case "muse-spark-1.3-contributor":
		return 0.10, 0.20
	case "muse-wonder-1.0":
		return 4, 20
	}
	return 1.25, 4.25
}
