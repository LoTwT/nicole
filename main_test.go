package main

import (
	"runtime"
	"testing"
)

func TestApplicationInfo(t *testing.T) {
	info := NewApplication("0.0.1").Info()

	if info.Version != "0.0.1" {
		t.Errorf("Version = %q, want %q", info.Version, "0.0.1")
	}
	if info.OS != runtime.GOOS {
		t.Errorf("OS = %q, want %q", info.OS, runtime.GOOS)
	}
	if info.Arch != runtime.GOARCH {
		t.Errorf("Arch = %q, want %q", info.Arch, runtime.GOARCH)
	}
	if info.GoVersion != runtime.Version() {
		t.Errorf("GoVersion = %q, want %q", info.GoVersion, runtime.Version())
	}
}
