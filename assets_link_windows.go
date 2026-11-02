//go:build windows

package main

import (
	"errors"
	"io/fs"
	"syscall"
)

// hardLinkUnsupported limits the exclusive-create fallback to errors that
// filesystems use when hard links are unavailable. EPERM is included because
// some mounts report it for Link; the fallback still opens with O_EXCL, so a
// real permission error remains an error. Windows uses raw Errno values
// because the syscall package does not name all of these constants.
func hardLinkUnsupported(err error) bool {
	return errors.Is(err, fs.ErrPermission) ||
		errors.Is(err, syscall.Errno(1)) || // ERROR_INVALID_FUNCTION
		errors.Is(err, syscall.Errno(17)) || // ERROR_NOT_SAME_DEVICE
		errors.Is(err, syscall.Errno(50)) // ERROR_NOT_SUPPORTED
}
