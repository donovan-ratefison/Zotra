package ai

import (
	"strings"
	"testing"
)

// TestPromptLanguageRules checks that each prompt with free text tells
// the model which language to use, and that ids stay in English.
func TestPromptLanguageRules(t *testing.T) {
	snake := "Ids, field names and decision values stay in English snake case"
	cases := []struct {
		row, name, prompt string
		want              []string
	}{
		{"P1", "PolicyToProcessSystem", PolicyToProcessSystem, []string{"in the language of the policy", snake}},
		{"P2", "ChangeProcessSystem", ChangeProcessSystem, []string{"in the language of the process file", snake}},
		{"P3", "RestateChangeSystem", RestateChangeSystem, []string{"Answer in the language of the request", "or with the same words in the language of the request"}},
		{"P4", "ExplainCheckSystem", ExplainCheckSystem, []string{"Answer in the language of the check message"}},
		{"P5", "UpdatePolicySystem", UpdatePolicySystem, []string{"Answer in the language of the policy paragraphs"}},
		{"P6", "UpdatePolicyCheckSystem", UpdatePolicyCheckSystem, []string{"Answer in the language of the policy paragraphs"}},
	}
	refused := []string{"message in English", "plain English", "Write in English"}
	for _, c := range cases {
		for _, w := range c.want {
			if !strings.Contains(c.prompt, w) {
				t.Errorf("%s %s: missing %q", c.row, c.name, w)
			}
		}
		for _, r := range refused {
			if strings.Contains(c.prompt, r) {
				t.Errorf("P7 %s: holds the refused text %q", c.name, r)
			}
		}
	}
}
