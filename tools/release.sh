#!/bin/sh
# Builds a gamja release whose version badge matches its tag: tags HEAD,
# builds, checks the badge and zips dist/ as gamja-<tag>.zip (a top-level
# gamja/ folder). With a release notes file, also pushes the tag to the
# "github" remote and publishes the release on pbtrung/gamja.
#
# Usage: tools/release.sh <tag> [notes-file]
set -eu

tag="${1:?usage: tools/release.sh <tag> [notes-file]}"
notes="${2:-}"
repo="pbtrung/gamja"
remote="github"

cd "$(dirname "$0")/.."

case "$tag" in
v[0-9]*) ;;
*)
	echo "invalid tag $tag, expected e.g. v1.2.3" >&2
	exit 1
	;;
esac
if [ -n "$(git status --porcelain)" ]; then
	echo "the working tree has uncommitted changes" >&2
	exit 1
fi
if [ -n "$notes" ] && [ ! -f "$notes" ]; then
	echo "no release notes file $notes" >&2
	exit 1
fi
if [ -n "${GAMJA_VERSION:-}" ]; then
	echo "GAMJA_VERSION is set, the badge wouldn't come from the tag" >&2
	exit 1
fi
for cmd in zip ${notes:+gh}; do
	if ! command -v "$cmd" >/dev/null; then
		echo "$cmd is required" >&2
		exit 1
	fi
done

# Delete a tag created here if the release fails before it's pushed, so that
# running the script again from a fixed commit doesn't find it in the way
created_tag=""
tmp=""
cleanup() {
	status=$?
	[ -n "$tmp" ] && rm -rf "$tmp"
	if [ "$status" -ne 0 ] && [ -n "$created_tag" ]; then
		git tag -d "$created_tag" >/dev/null && echo "deleted the tag $created_tag" >&2
	fi
}
trap cleanup EXIT

# The badge comes from the latest tag when building: tag first
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
	if [ "$(git rev-parse "$tag^{commit}")" != "$(git rev-parse HEAD)" ]; then
		echo "tag $tag already exists on another commit" >&2
		exit 1
	fi
else
	git tag "$tag"
	created_tag="$tag"
fi
latest="$(git describe --tags --abbrev=0)"
if [ "$latest" != "$tag" ]; then
	echo "the latest tag of HEAD is $latest, not $tag" >&2
	exit 1
fi

npm run build

badge="$(cat dist/assets/*.js | grep -o 'gamja version`,children:`[^`]*' | sed 's/.*`//' | sort -u)"
if [ "$badge" != "$tag" ]; then
	echo "the built version badge is \"$badge\", not $tag" >&2
	exit 1
fi

zip="gamja-$tag.zip"
tmp="$(mktemp -d)"
cp -R dist "$tmp/gamja"
rm -f "$zip"
(cd "$tmp" && zip -qr "$OLDPWD/$zip" gamja)
echo "built $zip with version badge $badge"

if [ -z "$notes" ]; then
	echo "not published: push the tag to $remote and create the release, or pass a notes file"
	exit 0
fi
git push "$remote" "refs/tags/$tag"
# Pushed: keep the tag even if creating the release fails
created_tag=""
gh release create "$tag" -R "$repo" --title "$tag" --notes-file "$notes" "$zip"
