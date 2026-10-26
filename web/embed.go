// Package web holds the built web app.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// Dist returns the files of the built web app.
func Dist() (fs.FS, error) { return fs.Sub(dist, "dist") }
