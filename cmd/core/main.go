package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"time"

	"researchdesk.next/internal/workspace"
)

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

func run() error {
	data := flag.String("data", "", "absolute path to an independent workspace")
	flag.Parse()
	input := bufio.NewReaderSize(os.Stdin, 256)
	token, _, err := input.ReadLine()
	if err != nil || len(token) != 64 {
		return errors.New("missing desktop session token")
	}
	library, err := workspace.Open(*data)
	if err != nil {
		return err
	}
	defer library.Close()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return err
	}
	defer listener.Close()
	server := &http.Server{
		Handler:           library.Handler(listener.Addr().String(), string(token)),
		ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 15 * time.Second,
		ReadTimeout: 4 * time.Minute, WriteTimeout: 4 * time.Minute, MaxHeaderBytes: 16 << 10,
	}
	if err := json.NewEncoder(os.Stdout).Encode(map[string]string{"address": listener.Addr().String()}); err != nil {
		return err
	}
	go func() {
		_, _ = io.Copy(io.Discard, input)
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			_ = server.Close()
		}
	}()
	if err := server.Serve(listener); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
