package cli

import (
	"fmt"

	"github.com/spf13/cobra"

	"github.com/alrors/alror/internal/capability"
	"github.com/alrors/alror/internal/cli/ui"
)

func capabilitiesCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "capabilities",
		Aliases: []string{"caps"},
		Short:   "Show what each target and metrics provider can really do",
		Long: "Prints the capability matrix: for each target and operation, whether it is\n" +
			"verified, experimental, simulated or unsupported. Unsupported operations are\n" +
			"refused; experimental ones are reported as requested, never as observed.",
		RunE: func(*cobra.Command, []string) error {
			if g.json {
				return printJSON(map[string]any{"targets": capability.Targets, "metrics_providers": capability.Providers})
			}
			headers := []string{"TARGET"}
			for _, op := range capability.Operations {
				headers = append(headers, string(op))
			}
			rows := make([][]string, 0, len(capability.Targets))
			for _, t := range capability.Targets {
				row := []string{t.Name}
				for _, op := range capability.Operations {
					row = append(row, maturityStyle(t.Maturity(op)))
				}
				rows = append(rows, row)
			}
			fmt.Println(ui.Section("Targets"))
			fmt.Println()
			fmt.Println(ui.Table(headers, rows))
			for _, t := range capability.Targets {
				fmt.Println(ui.Fainter.Render(t.Name + ": " + t.Notes))
			}
			fmt.Println()
			fmt.Println(ui.Section("Metrics providers"))
			fmt.Println()
			prows := make([][]string, 0, len(capability.Providers))
			for _, p := range capability.Providers {
				prows = append(prows, []string{p.Name, maturityStyle(p.Maturity), ui.Dim.Render(p.Notes)})
			}
			fmt.Println(ui.Table([]string{"PROVIDER", "MATURITY", "NOTES"}, prows))
			return nil
		},
	}
}

func maturityStyle(m capability.Maturity) string {
	switch m {
	case capability.Verified:
		return ui.Green.Render(string(m))
	case capability.Experimental:
		return ui.Amber.Render(string(m))
	case capability.Unsupported:
		return ui.Red.Render(string(m))
	default:
		return ui.Dim.Render(string(m))
	}
}
