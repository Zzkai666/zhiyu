//go:build !windows

package workspace

import "errors"

func protectTranslationKey([]byte) ([]byte, error) {
	return nil, errors.New("system credential protection is unavailable")
}
func unprotectTranslationKey([]byte) ([]byte, error) {
	return nil, errors.New("system credential protection is unavailable")
}
