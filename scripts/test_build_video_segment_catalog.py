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


if __name__ == "__main__":
    unittest.main()
