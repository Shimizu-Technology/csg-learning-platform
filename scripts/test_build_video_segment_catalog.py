import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.build_video_segment_catalog import apply_focused_catalog


class ApplyFocusedCatalogTest(unittest.TestCase):
    def test_rejects_removed_focused_lessons_from_a_resolved_base_catalog(self) -> None:
        base = [
            {
                "lesson_id": 213,
                "content_block_id": 500,
                "source_id": "video-id",
                "review_method": "student_path_transcript_reviewed",
                "video_segments": [],
            }
        ]

        with self.assertRaisesRegex(ValueError, "Regenerate from the inventory"):
            apply_focused_catalog(base, [])

    def test_supports_multiple_focused_review_methods(self) -> None:
        base = [
            {
                "lesson_id": 323,
                "content_block_id": 538,
                "source_id": "alumni-video",
                "review_method": "transcript_range_caption_boundary",
                "video_segments": [],
            }
        ]
        focused = [
            {
                "lesson_id": 323,
                "source_id": "alumni-video",
                "review_method": "alumni_library_transcript_reviewed",
                "video_segments": [
                    {"label": "Ruby data types", "start_seconds": 840, "end_seconds": 1200, "required": False}
                ],
            }
        ]

        result = apply_focused_catalog(base, focused)

        self.assertEqual("alumni_library_transcript_reviewed", result[0]["review_method"])
        self.assertEqual(focused[0]["video_segments"], result[0]["video_segments"])

    def test_rejects_unknown_focused_review_method(self) -> None:
        base = [{"lesson_id": 323, "content_block_id": 538, "source_id": "video", "video_segments": []}]
        focused = [{"lesson_id": 323, "source_id": "video", "review_method": "unreviewed", "video_segments": []}]

        with self.assertRaisesRegex(ValueError, "unsupported review method"):
            apply_focused_catalog(base, focused)

    def test_cli_combines_two_focused_catalogs_and_rejects_cross_file_duplicates(self) -> None:
        script = Path(__file__).with_name("build_video_segment_catalog.py")
        base = [
            {"lesson_id": 213, "content_block_id": 500, "source_id": "student-video", "review_method": "generated", "video_segments": []},
            {"lesson_id": 323, "content_block_id": 538, "source_id": "alumni-video", "review_method": "generated", "video_segments": []},
        ]
        student = [
            {"lesson_id": 213, "source_id": "student-video", "review_method": "student_path_transcript_reviewed", "video_segments": []}
        ]
        alumni = [
            {"lesson_id": 323, "source_id": "alumni-video", "review_method": "alumni_library_transcript_reviewed", "video_segments": []}
        ]

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            base_path = self.write_json(root / "base.json", base)
            student_path = self.write_json(root / "student.json", student)
            alumni_path = self.write_json(root / "alumni.json", alumni)
            output_path = root / "output.json"
            command = [
                sys.executable,
                str(script),
                "--base-catalog", str(base_path),
                "--focused-catalog", str(student_path),
                "--focused-catalog", str(alumni_path),
                "--output", str(output_path),
            ]

            completed = subprocess.run(command, capture_output=True, text=True, check=False)

            self.assertEqual(0, completed.returncode, completed.stderr)
            methods = {entry["review_method"] for entry in json.loads(output_path.read_text())}
            self.assertEqual({"student_path_transcript_reviewed", "alumni_library_transcript_reviewed"}, methods)

            duplicate_path = self.write_json(root / "duplicate.json", [ {**alumni[0], "lesson_id": 213, "source_id": "student-video"} ])
            duplicate_command = [*command[:-4], "--focused-catalog", str(duplicate_path), "--output", str(output_path)]
            duplicate = subprocess.run(duplicate_command, capture_output=True, text=True, check=False)

            self.assertNotEqual(0, duplicate.returncode)
            self.assertIn("Focused catalog repeats lesson 213", duplicate.stderr)

    def write_json(self, path: Path, value: object) -> Path:
        path.write_text(json.dumps(value))
        return path


if __name__ == "__main__":
    unittest.main()
