import importlib.util
import unittest
import subprocess
import tempfile
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("ci_docs", Path(__file__).with_name("ci-docs-only.py"))
ci_docs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci_docs)


class DocsOnlyTest(unittest.TestCase):
    def test_prose(self):
        self.assertTrue(ci_docs.docs_only(["README.md", "docs/qa/notes.md"]))

    def test_code_or_uncertain_changes_run_full_suite(self):
        for paths in ([], [""], ["docs/example.rb"], ["AGENTS.md"],
                      ["web/src/app.ts", "docs/notes.md"], [".github/workflows/ci.yml"],
                      ["api/test/example_test.rb", "docs/example.md"], ["docs/build.sh"]):
            with self.subTest(paths=paths):
                self.assertFalse(ci_docs.docs_only(paths))


class GitDiffTest(unittest.TestCase):
    def test_real_git_comparisons(self):
        script = Path(__file__).with_name("ci-docs-only.py").resolve()
        with tempfile.TemporaryDirectory(prefix="csg-ci-filter-") as directory:
            root = Path(directory)

            def git(*args):
                return subprocess.check_output(
                    ["git", "-c", "user.name=CI fixture", "-c", "user.email=ci@example.invalid", *args],
                    cwd=root, stderr=subprocess.DEVNULL,
                ).decode().strip()

            def classify(base):
                return subprocess.run([sys.executable, str(script), base, "HEAD"],
                                      cwd=root, capture_output=True, text=True, check=True).stdout.strip()

            git("init")
            (root / "README.md").write_text("Initial docs")
            git("add", ".")
            git("commit", "-m", "baseline")
            base = git("rev-parse", "HEAD")
            self.assertEqual(classify(base), "run_full=true")  # Empty diff fails open.
            (root / "README.md").write_text("Updated docs")
            git("commit", "-am", "docs")
            self.assertEqual(classify(base), "run_full=false")
            (root / "app.rb").write_text("puts 'test'")
            git("add", ".")
            git("commit", "-m", "code")
            self.assertEqual(classify(base), "run_full=true")
            base = git("rev-parse", "HEAD")
            (root / "docs").mkdir()
            git("mv", "app.rb", "docs/example.md")
            git("commit", "-m", "rename code as docs")
            self.assertEqual(classify(base), "run_full=true")
            self.assertEqual(classify("missing-base"), "run_full=true")


if __name__ == "__main__":
    unittest.main()
