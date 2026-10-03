import unittest

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


if __name__ == "__main__":
    unittest.main()
