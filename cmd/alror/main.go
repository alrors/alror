// Command alror is the Alror CLI.
package main

import (
	"os"

	"github.com/alrors/alror/internal/cli"
)

func main() { os.Exit(cli.Execute()) }
