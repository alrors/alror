package runner

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/alrors/alror/internal/driver"
)

var (
	hexSHA   = regexp.MustCompile(`^[0-9a-f]{7,40}$`)
	tagForms = []*regexp.Regexp{
		regexp.MustCompile(`^([0-9a-f]{7,40})$`),     // 3f9c2ab…
		regexp.MustCompile(`^sha-([0-9a-f]{7,40})$`), // sha-3f9c2ab (docker/metadata-action)
		regexp.MustCompile(`-g([0-9a-f]{7,40})$`),    // v1.4.2-3-g3f9c2ab (git describe)
		regexp.MustCompile(`[-_.]([0-9a-f]{7,40})$`), // 1.4.2-3f9c2ab, main_3f9c2ab
	}
	hasDigit  = regexp.MustCompile(`[0-9]`)
	hasLetter = regexp.MustCompile(`[a-f]`)
)

// CommitFor derives the commit an image change was built from, without
// guessing. In order:
//
//  1. the pod template annotation alror.dev/commit,
//  2. the pod template label alror.dev/commit,
//  3. the image tag, when it is a commit SHA (7 to 40 lowercase hex
//     characters) on its own or as sha-<sha>, -g<sha> or a -/_/. suffix.
//     A short SHA must mix digits and letters, so dates and words never match.
//
// It returns the SHA and how it was found; with no SHA, how says why the
// commit is unknown.
func CommitFor(ro *driver.Rollout, image string) (sha, how string) {
	for _, src := range []struct {
		m    map[string]string
		desc string
	}{{ro.TemplateAnnotations, "pod template annotation"}, {ro.TemplateLabels, "pod template label"}} {
		v, ok := src.m[driver.AnnotationCommit]
		if !ok {
			continue
		}
		v = strings.TrimSpace(v)
		if hexSHA.MatchString(strings.ToLower(v)) {
			return strings.ToLower(v), src.desc + " " + driver.AnnotationCommit
		}
		return "", fmt.Sprintf("%s %s=%q is not a commit SHA", src.desc, driver.AnnotationCommit, v)
	}
	if sha := commitFromTag(image); sha != "" {
		return sha, "image tag"
	}
	return "", "no " + driver.AnnotationCommit + " annotation or label, and the image tag is not a commit SHA"
}

// commitFromTag returns the SHA in an image tag, or "".
func commitFromTag(image string) string {
	ref, _, _ := strings.Cut(image, "@") // a digest identifies content, not a commit
	slash := strings.LastIndex(ref, "/")
	colon := strings.LastIndex(ref, ":")
	if colon <= slash {
		return "" // no tag (a colon before the last slash is a registry port)
	}
	tag := ref[colon+1:]
	for _, re := range tagForms {
		m := re.FindStringSubmatch(tag)
		if m == nil {
			continue
		}
		sha := m[1]
		if len(sha) < 40 && (!hasDigit.MatchString(sha) || !hasLetter.MatchString(sha)) {
			continue
		}
		return sha
	}
	return ""
}
