module CoursePackageFixture
  def package
    {
      "schema_version" => 1, "key" => "python-fundamentals", "revision" => "2026-10-04", "title" => "Python recording package", "description" => "Fictional practice", "total_weeks" => 3,
      "modules" => [ { "key" => "core", "title" => "Python", "description" => "Learn first", "total_days" => 21, "schedule_days" => "daily", "lessons" => [
        { "key" => "lesson-1", "title" => "Read a value", "lesson_type" => "video", "release_day" => 1, "required" => true, "blocks" => [
          { "key" => "video", "block_type" => "video", "body" => "", "submission_type" => "manual_complete" },
          { "key" => "instructions", "block_type" => "text", "body" => "Predict then run.", "submission_type" => "manual_complete" }
        ] },
        { "key" => "exercise-1", "title" => "E1", "lesson_type" => "exercise", "release_day" => 1, "required" => true, "blocks" => [ { "key" => "answer", "block_type" => "exercise", "body" => "Explain the result", "solution" => "Staff answer", "filename" => "hello.py", "submission_type" => "text_submission" } ] }
      ] } ]
    }
  end
end
