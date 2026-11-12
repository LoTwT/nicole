//go:build unix

package main

import "syscall"

// Opening a FIFO read-only normally waits for a writer. O_NONBLOCK affects
// special files only and is harmless on regular files; the caller verifies the
// opened descriptor before reading.
const searchOpenNonblock = syscall.O_NONBLOCK
