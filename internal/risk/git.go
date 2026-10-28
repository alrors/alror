package risk

import (
	"bytes"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// FromGit collects the change between base and HEAD in repo dir.
// When HEAD equals base (nothing committed yet), it falls back to the
// uncommitted working-tree diff so `alror risk` is useful before a commit.
func FromGit(dir, base string) (Change, error) {
	if base == "" {
		base = defaultBase(dir)
	}
	var c Change

	numstat, err := git(dir, "diff", "--numstat", base+"...HEAD")
	if err != nil {
		return c, fmt.Errorf("git diff against %s: %w", base, err)
	}
	if strings.TrimSpace(numstat) == "" {
		if numstat, err = git(dir, "diff", "--numstat", "HEAD"); err != nil {
			return c, err
		}
	}
	c.Files = parseNumstat(numstat)

	log, err := git(dir, "log", base+"..HEAD", "--format=%an <%ae>%x1f%B%x1e")
	if err == nil {
		for _, entry := range strings.Split(log, "\x1e") {
			parts := strings.SplitN(strings.TrimSpace(entry), "\x1f", 2)
			if parts[0] == "" {
				continue
			}
			c.Authors = append(c.Authors, parts[0])
			if len(parts) == 2 {
				c.Message += parts[1] + "\n"
			}
		}
	}
	return c, nil
}

// HeadCommit returns the full SHA of HEAD in repo dir.
func HeadCommit(dir string) (string, error) {
	out, err := git(dir, "rev-parse", "HEAD")
	return strings.TrimSpace(out), err
}

// FromCommit collects the change one commit introduced, against its first
// parent (for a merge commit, the whole merged branch). It fails when dir is
// not a git checkout that contains the commit; it never fetches.
func FromCommit(dir, sha string) (Change, error) {
	var c Change
	if _, err := git(dir, "cat-file", "-e", sha+"^{commit}"); err != nil {
		return c, fmt.Errorf("commit %s is not in %s: %w", sha, dir, err)
	}
	numstat, err := git(dir, "diff", "--numstat", sha+"^1", sha)
	if err != nil {
		return c, fmt.Errorf("git diff %s^1 %s: %w", sha, sha, err)
	}
	c.Files = parseNumstat(numstat)
	if out, err := git(dir, "log", "-1", "--format=%an <%ae>%x1f%B", sha); err == nil {
		if parts := strings.SplitN(strings.TrimSpace(out), "\x1f", 2); parts[0] != "" {
			c.Authors = append(c.Authors, parts[0])
			if len(parts) == 2 {
				c.Message = parts[1] + "\n"
			}
		}
	}
	return c, nil
}

func defaultBase(dir string) string {
	for _, b := range []string{"origin/main", "main", "origin/master", "master"} {
		if _, err := git(dir, "rev-parse", "--verify", "--quiet", b); err == nil {
			return b
		}
	}
	return "HEAD"
}

func parseNumstat(out string) []FileChange {
	var files []FileChange
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		f := strings.Split(line, "\t")
		if len(f) != 3 {
			continue
		}
		added, _ := strconv.Atoi(f[0]) // "-" for binary files counts as 0
		deleted, _ := strconv.Atoi(f[1])
		files = append(files, FileChange{Path: f[2], Added: added, Deleted: deleted})
	}
	return files
}

func git(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("%v: %s", err, strings.TrimSpace(errb.String()))
	}
	return out.String(), nil
}
