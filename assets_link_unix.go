//go:build unix

package main

import (
	"errors"
	"io/fs"
	"syscall"
)

// hardLinkUnsupported limits the exclusive-create fallback to errors that
// filesystems use when hard links are unavailable. EPERM is included because
// some mounts report it for Link; the fallback still opens with O_EXCL, so a
// real permission error remains an error.
func hardLinkUnsupported(err error) bool {
	return errors.Is(err, fs.ErrPermission) ||
		errors.Is(err, syscall.ENOTSUP) ||
		errors.Is(err, syscall.EOPNOTSUPP) ||
		errors.Is(err, syscall.EXDEV)
}
