package workspace

import (
	"golang.org/x/sys/windows"
	"unsafe"
)

func protectTranslationKey(source []byte) ([]byte, error) {
	input := windows.DataBlob{Size: uint32(len(source)), Data: &source[0]}
	var output windows.DataBlob
	if err := windows.CryptProtectData(&input, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &output); err != nil {
		return nil, err
	}
	defer windows.LocalFree(windows.Handle(uintptr(unsafe.Pointer(output.Data))))
	return append([]byte(nil), unsafe.Slice(output.Data, int(output.Size))...), nil
}
func unprotectTranslationKey(source []byte) ([]byte, error) {
	input := windows.DataBlob{Size: uint32(len(source)), Data: &source[0]}
	var output windows.DataBlob
	if err := windows.CryptUnprotectData(&input, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &output); err != nil {
		return nil, err
	}
	defer windows.LocalFree(windows.Handle(uintptr(unsafe.Pointer(output.Data))))
	return append([]byte(nil), unsafe.Slice(output.Data, int(output.Size))...), nil
}
