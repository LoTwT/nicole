package main

import (
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"strings"
)

// WritingPreferences changes the reading surface, never the Markdown bytes.
type WritingPreferences struct {
	FocusMode      bool              `json:"focusMode"`
	TypewriterMode bool              `json:"typewriterMode"`
	FontSize       float64           `json:"fontSize"`
	LineHeight     float64           `json:"lineHeight"`
	ContentWidth   float64           `json:"contentWidth"`
	Keybindings    map[string]string `json:"keybindings"`
	CustomCSS      string            `json:"customCss"`
}

func defaultWritingPreferences() WritingPreferences {
	return WritingPreferences{FontSize: 18, LineHeight: 1.7, ContentWidth: 65, Keybindings: map[string]string{}}
}

func boundedWritingNumber(value, fallback, low, high float64) float64 {
	if value == 0 || math.IsNaN(value) || math.IsInf(value, 0) {
		return fallback
	}
	return math.Min(high, math.Max(low, value))
}

var writingCommandID = regexp.MustCompile(`^[a-z][a-z0-9.-]{0,79}$`)
var unsafeWritingCSS = regexp.MustCompile(`(?i)@|url\s*\(|expression\s*\(|javascript:|\\|<|>`)

func normalizeWritingPreferences(value WritingPreferences) WritingPreferences {
	value.FontSize = boundedWritingNumber(value.FontSize, 18, 12, 36)
	value.LineHeight = boundedWritingNumber(value.LineHeight, 1.7, 1.2, 2.4)
	value.ContentWidth = boundedWritingNumber(value.ContentWidth, 65, 40, 100)
	clean := map[string]string{}
	for id, key := range value.Keybindings {
		if len(clean) >= 200 {
			break
		}
		if writingCommandID.MatchString(id) && len(key) <= 80 {
			clean[id] = strings.TrimSpace(key)
		}
	}
	value.Keybindings = clean
	if len(value.CustomCSS) > 20000 || unsafeWritingCSS.MatchString(value.CustomCSS) {
		value.CustomCSS = ""
	}
	return value
}

func decodeWritingPreferences(raw json.RawMessage) WritingPreferences {
	value := defaultWritingPreferences()
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return value
	}
	value.FocusMode = decodeBoolWithDefault(fields["focusMode"], false)
	value.TypewriterMode = decodeBoolWithDefault(fields["typewriterMode"], false)
	for key, target := range map[string]*float64{"fontSize": &value.FontSize, "lineHeight": &value.LineHeight, "contentWidth": &value.ContentWidth} {
		var number float64
		if json.Unmarshal(fields[key], &number) == nil && number != 0 {
			*target = number
		}
	}
	value.CustomCSS = decodeString(fields["customCss"])
	var keys map[string]json.RawMessage
	if json.Unmarshal(fields["keybindings"], &keys) == nil {
		for id, rawKey := range keys {
			var key string
			if json.Unmarshal(rawKey, &key) == nil {
				value.Keybindings[id] = key
			}
		}
	}
	return normalizeWritingPreferences(value)
}

// SetWritingPreferences updates this group atomically without replacing any
// existing setting outside it. The page merges field intents with a read baseline.
func (s *Settings) SetWritingPreferences(value WritingPreferences) error {
	if len(value.CustomCSS) > 20000 {
		return errors.New("自定义 CSS 不能超过 20 KB")
	}
	if unsafeWritingCSS.MatchString(value.CustomCSS) {
		return errors.New("自定义 CSS 不支持外部资源、转义或 at-rule")
	}
	return s.store.update(func(settings *AppSettings) { settings.WritingPreferences = normalizeWritingPreferences(value) })
}
