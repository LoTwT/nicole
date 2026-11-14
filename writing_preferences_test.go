package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestWritingPreferencesDecodeAndPersist(t *testing.T) {
	store, dir := newTestSettings(t)
	if err := os.WriteFile(filepath.Join(dir, settingsFileName), []byte(`{"theme":"dark","uiFont":"Test Font","writingPreferences":{"focusMode":true,"typewriterMode":"bad","fontSize":24,"lineHeight":"bad","contentWidth":80,"keybindings":{"format.bold":"Mod-Alt-b","format.italic":4}}}`), 0600); err != nil {
		t.Fatal(err)
	}
	value, err := store.get()
	if err != nil {
		t.Fatal(err)
	}
	if !value.WritingPreferences.FocusMode || value.WritingPreferences.TypewriterMode || value.WritingPreferences.FontSize != 24 || value.WritingPreferences.LineHeight != 1.7 || value.Theme != "dark" || value.UIFont != "Test Font" {
		t.Fatalf("unexpected settings: %#v", value)
	}
	value.WritingPreferences.TypewriterMode = true
	if err := NewSettings(store).SetWritingPreferences(value.WritingPreferences); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(dir, settingsFileName))
	if err != nil {
		t.Fatal(err)
	}
	var saved AppSettings
	if err = json.Unmarshal(data, &saved); err != nil {
		t.Fatal(err)
	}
	if !saved.WritingPreferences.TypewriterMode || saved.UIFont != "Test Font" {
		t.Fatalf("unrelated fields lost: %#v", saved)
	}
}

func TestWritingPreferencesRejectsExternalCSSAndBoundsNumbers(t *testing.T) {
	store, _ := newTestSettings(t)
	service := NewSettings(store)
	value := defaultWritingPreferences()
	value.CustomCSS = "@import 'https://example.test/style.css';"
	if err := service.SetWritingPreferences(value); err == nil {
		t.Fatal("external CSS accepted")
	}
	value.CustomCSS = ".cm-content { color: red; }"
	value.FontSize = 100
	value.ContentWidth = 10
	if err := service.SetWritingPreferences(value); err != nil {
		t.Fatal(err)
	}
	saved, err := store.get()
	if err != nil {
		t.Fatal(err)
	}
	if saved.WritingPreferences.FontSize != 36 || saved.WritingPreferences.ContentWidth != 40 {
		t.Fatalf("bounds ignored: %#v", saved.WritingPreferences)
	}
}
