//go:build !unix

package app

// Filesystem paths on non-Unix targets do not expose Unix FIFOs, and os.Root
// paths are relative, so there is no named-pipe open to guard here.
const searchOpenNonblock = 0
