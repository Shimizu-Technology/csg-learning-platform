"""Conservatively identify prose-only changes; uncertainty runs the full suite."""
import subprocess
import sys


def docs_only(paths):
    return bool(paths) and all(
        path == "README.md" or (path.startswith("docs/") and path.endswith(".md"))
        for path in paths
    )


if __name__ == "__main__":
    try:
        # --no-renames includes both sides of moves (code renamed to docs must run).
        result = subprocess.run(
            ["git", "diff", "--no-renames", "--name-only", "-z", *sys.argv[1:]],
            check=True, stdout=subprocess.PIPE,
        )
        paths = result.stdout.decode("utf-8").rstrip("\0").split("\0")
        skip = docs_only(paths)
    except (subprocess.CalledProcessError, UnicodeDecodeError):
        skip = False
    print(f"run_full={'false' if skip else 'true'}")
