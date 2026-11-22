require "test_helper"
require "open3"
require "tmpdir"

class CoursePackageMarkdownConverterTest < ActiveSupport::TestCase
  test "constants stay in exact parity with CoursePackageImporter and models" do
    assert_equal CoursePackageImporter::MAX_BYTES, CoursePackageMarkdownConverter::MAX_BYTES
    assert_equal CoursePackageImporter::IDENTIFIER, CoursePackageMarkdownConverter::IDENTIFIER
    assert_equal CoursePackageImporter::TEXT_LIMIT, CoursePackageMarkdownConverter::TEXT_LIMIT
    assert_equal CoursePackageImporter::MEDIA_BODY_S3_KEY_PATTERN, CoursePackageMarkdownConverter::MEDIA_BODY_S3_KEY_PATTERN
    assert_equal CurriculumModule::SCHEDULE_PATTERNS, CoursePackageMarkdownConverter::SCHEDULE_PATTERNS
    assert_equal CurriculumModule.module_types.keys.sort, CoursePackageMarkdownConverter::MODULE_TYPES.sort
    assert_equal Lesson.lesson_types.keys.sort, CoursePackageMarkdownConverter::LESSON_TYPES.sort
    assert_equal ContentBlock.block_types.keys.sort, CoursePackageMarkdownConverter::BLOCK_TYPES.sort
  end

  test "full round-trip converts markdown repo and imports cleanly via CoursePackageImporter" do
    with_sample_repo do |dir|
      json = CoursePackageMarkdownConverter.new(dir).to_json
      parsed = JSON.parse(json)

      preview = CoursePackageImporter.new(parsed).preview
      assert_equal "python-fundamentals", preview[:key]
      assert_equal "2026-10-04", preview[:revision]
      assert_equal 2, preview[:modules]
      assert_equal 4, preview[:lessons]
      assert_equal 7, preview[:blocks]
      assert_equal "draft", preview[:status]
      assert_equal false, preview[:assigned]

      first_import = CoursePackageImporter.new(parsed).call
      assert_equal false, first_import[:unchanged]

      curriculum = Curriculum.find(first_import[:curriculum_id])
      assert curriculum.draft?
      assert_equal "Python Fundamentals", curriculum.name
      assert_equal 3, curriculum.total_weeks

      core_mod, project_mod = curriculum.modules.ordered.to_a
      assert core_mod.workshop?
      assert project_mod.recording?

      # Multi-block lesson: video placeholder + text + exercise with inline solution
      intro_lesson = core_mod.lessons.ordered.first
      assert_equal "video", intro_lesson.lesson_type
      video_block, text_block, exercise_block = intro_lesson.content_blocks.ordered.to_a
      assert_equal "video", video_block.block_type
      assert_equal "", video_block.body
      assert_nil video_block.video_url
      assert_nil video_block.s3_video_key

      assert_equal "text", text_block.block_type
      assert_equal "Predict what happens", text_block.title
      assert_includes text_block.body, "<!-- block key=fake type=text -->"
      assert_includes text_block.body, "<!-- solution -->"

      assert_equal "exercise", exercise_block.block_type
      assert_equal "hello.py", exercise_block.filename
      assert exercise_block.submission_type_text_submission?
      assert_equal "Explain what prints when `name` changes.", exercise_block.body
      assert_equal "Line 2 reassigns `name` before printing.", exercise_block.solution
      refute_includes exercise_block.body, "Line 2 reassigns"

      # Single-block lesson with convention-based private solution file
      ex_lesson = core_mod.lessons.ordered.second
      ex_block = ex_lesson.content_blocks.ordered.first
      assert_equal "exercise", ex_block.block_type
      assert_equal "sum.py", ex_block.filename
      assert_equal "Write a function `add(a, b)`.", ex_block.body
      assert_equal "def add(a, b):\n    return a + b", ex_block.solution
      refute_includes ex_block.body, "return a + b"

      # Checkpoint single-block lesson
      cp_lesson = core_mod.lessons.ordered.third
      cp_block = cp_lesson.content_blocks.ordered.first
      assert_equal "checkpoint", cp_block.block_type
      assert cp_block.submission_type_manual_complete?

      # Project lesson with rubric + explicit solution_file
      proj_lesson = project_mod.lessons.ordered.first
      assert_equal "project", proj_lesson.lesson_type
      proj_video, proj_brief = proj_lesson.content_blocks.ordered.to_a
      assert_equal "video", proj_video.block_type
      assert_equal "exercise", proj_brief.block_type
      assert proj_brief.submission_type_repo_and_live_url_submission?
      assert_equal "Budget Tracker Rubric", proj_brief.rubric.title
      assert_equal 2, proj_brief.rubric.rubric_criteria.count
      assert_equal "Accurate totals", proj_brief.rubric.rubric_criteria.first.title
      assert_equal "Private instructor grading guide.", proj_brief.solution
      refute_includes proj_brief.body, "Private instructor grading guide."

      # Deterministic output & idempotent re-import
      second_json = CoursePackageMarkdownConverter.new(dir).to_json
      assert_equal json, second_json
      second_import = CoursePackageImporter.new(JSON.parse(second_json)).call
      assert_equal({ curriculum_id: curriculum.id, unchanged: true }, second_import)
    end
  end

  test "supports root-level modules, lessons subdirectory, multiline YAML block markers, and CRLF normalization" do
    Dir.mktmpdir do |dir|
      write_repo_file(dir, "course.yaml", <<~YAML)
        key: crlf-course
        revision: 2026-11-01
        title: CRLF Course
        total_weeks: 1
        module_type: prework
      YAML

      write_repo_file(dir, "01-start/module.yaml", <<~YAML)
        key: start
        title: Getting Started
        total_days: 7
        schedule_days: weekdays
      YAML

      lesson_lf = <<~MD
        ---
        key: setup
        title: Setup
        lesson_type: project
        release_day: 0
        required: true
        ---

        <!-- block
        key: brief
        block_type: exercise
        submission_type: repo_url_submission
        rubric:
          title: Setup Rubric
          criteria:
            - title: Repo ready
              description: Initialized with README.
        -->
        Create your starter repo.

        <!-- solution -->
        Verify git log has at least one commit.
        <!-- endsolution -->
      MD

      write_repo_file(dir, "01-start/lessons/01-setup.md", lesson_lf)
      lf_json = CoursePackageMarkdownConverter.new(dir).to_json

      write_repo_file(dir, "01-start/lessons/01-setup.md", lesson_lf.gsub("\n", "\r\n"))
      crlf_json = CoursePackageMarkdownConverter.new(dir).to_json

      assert_equal lf_json, crlf_json
      parsed = JSON.parse(crlf_json)
      assert_equal "2026-11-01", parsed["revision"]
      assert_equal "prework", parsed.dig("modules", 0, "module_type")
      assert_equal "Create your starter repo.", parsed.dig("modules", 0, "lessons", 0, "blocks", 0, "body")
      assert_equal "Verify git log has at least one commit.", parsed.dig("modules", 0, "lessons", 0, "blocks", 0, "solution")

      result = CoursePackageImporter.new(parsed).call
      assert Curriculum.find(result[:curriculum_id]).modules.first.prework?
    end
  end

  test "supports private solution file per lesson/block under solutions directory without leaking into body" do
    Dir.mktmpdir do |dir|
      write_minimal_course(dir)
      write_repo_file(dir, "modules/01-core/01-multi.md", <<~MD)
        ---
        key: multi-ex
        title: Two Exercises
        lesson_type: exercise
        release_day: 0
        required: true
        ---

        <!-- block key=part-a type=exercise submission_type=text_submission -->
        Solve part A.

        <!-- block key=part-b type=exercise submission_type=text_submission -->
        Solve part B.
      MD
      write_repo_file(dir, "solutions/multi-ex/part-a.md", "Secret answer A\n")
      write_repo_file(dir, "solutions/multi-ex/part-b.md", "Secret answer B\n")

      package = CoursePackageMarkdownConverter.new(dir).call
      blocks = package.dig("modules", 0, "lessons", 0, "blocks")
      assert_equal "Solve part A.", blocks[0]["body"]
      assert_equal "Secret answer A", blocks[0]["solution"]
      refute_includes blocks[0]["body"], "Secret answer A"

      assert_equal "Solve part B.", blocks[1]["body"]
      assert_equal "Secret answer B", blocks[1]["solution"]
      refute_includes blocks[1]["body"], "Secret answer B"
    end
  end

  test "rejects missing frontmatter and invalid YAML with file and line diagnostics" do
    Dir.mktmpdir do |dir|
      write_minimal_course(dir)
      write_repo_file(dir, "modules/01-core/01-broken.md", "# No frontmatter here\n")

      error = assert_raises(CoursePackageMarkdownConverter::Error) do
        CoursePackageMarkdownConverter.new(dir).call
      end
      assert_includes error.message, "modules/01-core/01-broken.md:1"
      assert_includes error.message, "Missing YAML frontmatter"
    end
  end

  test "rejects duplicate keys across modules, lessons, and blocks" do
    Dir.mktmpdir do |dir|
      write_minimal_course(dir)
      write_repo_file(dir, "modules/01-core/01-a.md", minimal_lesson(key: "same-lesson"))
      write_repo_file(dir, "modules/01-core/02-b.md", minimal_lesson(key: "same-lesson"))

      error = assert_raises(CoursePackageMarkdownConverter::Error) do
        CoursePackageMarkdownConverter.new(dir).call
      end
      assert_includes error.message, "Duplicate lesson key 'same-lesson'"
      assert_includes error.message, "modules/01-core/02-b.md"
    end

    Dir.mktmpdir do |dir|
      write_minimal_course(dir)
      write_repo_file(dir, "modules/01-core/01-dup-block.md", <<~MD)
        ---
        key: dup-blocks
        title: Dup Blocks
        lesson_type: reading
        release_day: 0
        required: true
        ---

        <!-- block key=intro type=text -->
        First

        <!-- block key=intro type=text -->
        Second
      MD

      error = assert_raises(CoursePackageMarkdownConverter::Error) do
        CoursePackageMarkdownConverter.new(dir).call
      end
      assert_includes error.message, "Duplicate block key 'intro'"
    end
  end

  test "rejects invalid release_day for module schedule_days and non-boolean required" do
    Dir.mktmpdir do |dir|
      write_minimal_course(dir, schedule_days: "weekdays")
      write_repo_file(dir, "modules/01-core/01-sat.md", minimal_lesson(key: "sat", release_day: 5))

      error = assert_raises(CoursePackageMarkdownConverter::Error) do
        CoursePackageMarkdownConverter.new(dir).call
      end
      assert_includes error.message, "modules/01-core/01-sat.md:1"
      assert_includes error.message, "Invalid release_day 5 for schedule_days 'weekdays'"
    end

    Dir.mktmpdir do |dir|
      write_minimal_course(dir)
      write_repo_file(dir, "modules/01-core/01-req.md", <<~MD)
        ---
        key: bad-req
        title: Bad Required
        lesson_type: reading
        release_day: 0
        required: "false"
        ---
        Body
      MD

      error = assert_raises(CoursePackageMarkdownConverter::Error) do
        CoursePackageMarkdownConverter.new(dir).call
      end
      assert_includes error.message, "must be true or false"
    end
  end

  test "rejects over-limit blocks, lessons, body length, and rubric criteria" do
    Dir.mktmpdir do |dir|
      write_minimal_course(dir)
      blocks_md = (1..21).map { |i| "<!-- block key=b-#{i} type=text -->\nText #{i}\n" }.join("\n")
      write_repo_file(dir, "modules/01-core/01-too-many.md", <<~MD)
        ---
        key: too-many-blocks
        title: Too Many Blocks
        lesson_type: reading
        release_day: 0
        required: true
        ---

        #{blocks_md}
      MD

      error = assert_raises(CoursePackageMarkdownConverter::Error) do
        CoursePackageMarkdownConverter.new(dir).call
      end
      assert_includes error.message, "between 1 and 20 blocks"
    end

    Dir.mktmpdir do |dir|
      write_minimal_course(dir)
      (1..251).each do |i|
        write_repo_file(dir, format("modules/01-core/%03d-lesson.md", i), minimal_lesson(key: "lesson-#{i}"))
      end

      error = assert_raises(CoursePackageMarkdownConverter::Error) do
        CoursePackageMarkdownConverter.new(dir).call
      end
      assert_includes error.message, "between 1 and 250 lessons"
    end

    Dir.mktmpdir do |dir|
      write_minimal_course(dir)
      criteria = (1..13).map { |i| "    - title: C#{i}\n      description: Desc #{i}" }.join("\n")
      write_repo_file(dir, "modules/01-core/01-rubric.md", <<~MD)
        ---
        key: bad-rubric
        title: Bad Rubric
        lesson_type: project
        release_day: 0
        required: true
        rubric:
          title: Too Big
          criteria:
        #{criteria}
        ---
        Build it.
      MD

      error = assert_raises(CoursePackageMarkdownConverter::Error) do
        CoursePackageMarkdownConverter.new(dir).call
      end
      assert_includes error.message, "between 1 and 12 criteria"
    end
  end

  test "rejects media URLs, S3 keys, conflicting solutions, and content outside markers" do
    Dir.mktmpdir do |dir|
      write_minimal_course(dir)
      write_repo_file(dir, "modules/01-core/01-media-key.md", <<~MD)
        ---
        key: media-key
        title: Media Key
        lesson_type: video
        release_day: 0
        required: true
        ---

        <!-- block key=clip type=video video_url="https://example.com/v.mp4" -->
      MD

      error = assert_raises(CoursePackageMarkdownConverter::Error) do
        CoursePackageMarkdownConverter.new(dir).call
      end
      assert_includes error.message, "Media must be attached through the normal upload flow"
      assert_includes error.message, "modules/01-core/01-media-key.md:9"
    end

    Dir.mktmpdir do |dir|
      write_minimal_course(dir)
      write_repo_file(dir, "modules/01-core/01-media-body.md", <<~MD)
        ---
        key: media-body
        title: Media Body
        lesson_type: video
        release_day: 0
        required: true
        ---

        <!-- block key=clip type=video -->
        https://vimeo.com/123456
      MD

      error = assert_raises(CoursePackageMarkdownConverter::Error) do
        CoursePackageMarkdownConverter.new(dir).call
      end
      assert_includes error.message, "Media must be attached through the normal upload flow"
    end

    Dir.mktmpdir do |dir|
      write_minimal_course(dir)
      write_repo_file(dir, "modules/01-core/01-conflict.md", <<~MD)
        ---
        key: conflict
        title: Conflict
        lesson_type: exercise
        release_day: 0
        required: true
        ---
        Prompt

        <!-- solution -->
        Inline answer
      MD
      write_repo_file(dir, "solutions/conflict.md", "File answer\n")

      error = assert_raises(CoursePackageMarkdownConverter::Error) do
        CoursePackageMarkdownConverter.new(dir).call
      end
      assert_includes error.message, "Conflicting solution sources"
    end

    Dir.mktmpdir do |dir|
      write_minimal_course(dir)
      write_repo_file(dir, "modules/01-core/01-after-sol.md", <<~MD)
        ---
        key: after-sol
        title: After Solution
        lesson_type: exercise
        release_day: 0
        required: true
        ---
        Prompt

        <!-- solution -->
        Secret
        <!-- endsolution -->

        Accidental text after solution
      MD

      error = assert_raises(CoursePackageMarkdownConverter::Error) do
        CoursePackageMarkdownConverter.new(dir).call
      end
      assert_includes error.message, "Unexpected content after <!-- endsolution -->"
    end
  end

  test "prevents path traversal and symlinks escaping source directory" do
    Dir.mktmpdir do |parent|
      secret_file = File.join(parent, "secret.txt")
      File.write(secret_file, "TOP SECRET\n")

      repo_dir = File.join(parent, "course")
      write_minimal_course(repo_dir)
      write_repo_file(repo_dir, "modules/01-core/01-traversal.md", <<~MD)
        ---
        key: traversal
        title: Traversal
        lesson_type: exercise
        release_day: 0
        required: true
        solution_file: ../secret.txt
        ---
        Prompt
      MD

      error = assert_raises(CoursePackageMarkdownConverter::Error) do
        CoursePackageMarkdownConverter.new(repo_dir).call
      end
      assert_includes error.message, "escapes source directory"

      # Symlink escaping source directory
      FileUtils.mkdir_p(File.join(repo_dir, "solutions"))
      File.symlink(secret_file, File.join(repo_dir, "solutions", "linked.md"))
      write_repo_file(repo_dir, "modules/01-core/01-traversal.md", <<~MD)
        ---
        key: traversal
        title: Traversal
        lesson_type: exercise
        release_day: 0
        required: true
        solution_file: solutions/linked.md
        ---
        Prompt
      MD

      sym_error = assert_raises(CoursePackageMarkdownConverter::Error) do
        CoursePackageMarkdownConverter.new(repo_dir).call
      end
      assert_includes sym_error.message, "escapes source directory"
    end
  end

  test "CLI converts, dry-runs, verifies, and exits non-zero on invalid input" do
    cli = Rails.root.join("..", "scripts", "course-package-convert").to_s
    assert File.executable?(cli), "Expected #{cli} to be executable"

    with_sample_repo do |dir|
      Dir.mktmpdir do |out_dir|
        output_file = File.join(out_dir, "package.json")

        stdout, stderr, status = Open3.capture3(cli, dir, "-o", output_file)
        assert status.success?, "CLI failed: #{stderr}\n#{stdout}"
        assert File.file?(output_file)
        assert_includes stderr, "Wrote #{output_file}"

        parsed = JSON.parse(File.read(output_file))
        assert_equal "python-fundamentals", parsed["key"]
        assert_equal CoursePackageMarkdownConverter.new(dir).to_json, File.read(output_file)

        dry_stdout, dry_stderr, dry_status = Open3.capture3(cli, dir, "--dry-run")
        assert dry_status.success?, "Dry-run failed: #{dry_stderr}"
        assert_includes dry_stdout, "Valid course package: python-fundamentals"
        assert_includes dry_stdout, "Modules: 2, Lessons: 4, Blocks: 7"
      end
    end

    Dir.mktmpdir do |empty_dir|
      _stdout, stderr, status = Open3.capture3(cli, empty_dir, "--dry-run")
      refute status.success?
      assert_includes stderr, "Missing course.yml"
    end
  end

  test "rejects unclosed backtick, unclosed tilde, and mismatched code fences before solution markers" do
    cases = [
      [
        "01-unclosed-backtick.md",
        9,
        <<~MD
          ---
          key: unclosed-backtick
          title: Unclosed Backtick
          lesson_type: exercise
          release_day: 0
          required: true
          ---

          ```python
          print("oops")

          <!-- solution -->
          Secret staff answer that must not leak
        MD
      ],
      [
        "02-unclosed-tilde.md",
        9,
        <<~MD
          ---
          key: unclosed-tilde
          title: Unclosed Tilde
          lesson_type: exercise
          release_day: 0
          required: true
          ---

          ~~~ruby
          puts "oops"

          <!-- solution -->
          Secret staff answer that must not leak
        MD
      ],
      [
        "03-mismatched-tilde.md",
        9,
        <<~MD
          ---
          key: mismatched-tilde
          title: Mismatched Tilde
          lesson_type: exercise
          release_day: 0
          required: true
          ---

          ~~~~markdown
          Example
          ~~~

          <!-- solution -->
          Secret staff answer that must not leak
        MD
      ]
    ]

    cases.each do |filename, expected_line, markdown|
      Dir.mktmpdir do |dir|
        write_minimal_course(dir)
        write_repo_file(dir, "modules/01-core/#{filename}", markdown)

        error = assert_raises(CoursePackageMarkdownConverter::Error) do
          CoursePackageMarkdownConverter.new(dir).call
        end
        assert_includes error.message, "modules/01-core/#{filename}:#{expected_line}"
        assert_includes error.message, "Unterminated fenced code block"
      end
    end
  end

  test "rejects app-managed S3 key patterns in video and recording block bodies" do
    managed_bodies = [
      "content_videos/550e8400-e29b-41d4-a716-446655440000/lesson.mp4",
      "content_videos/block_42/20261004120000_clip.mp4",
      "recordings/cohort_7/20261004120000_deadbeef_session.mp4",
      "message_attachments/channel_3/550e8400-e29b-41d4-a716-446655440000/file.png",
      "course_resource_uploads/curriculum_5/token/pack.zip",
      "Watch `content_videos/block_1/20261004120000_clip.mp4` here",
      "See /recordings/cohort_1/20261004120000_abcd1234_demo.mp4"
    ]

    %w[video recording].each do |block_type|
      managed_bodies.each do |managed_body|
        Dir.mktmpdir do |dir|
          write_minimal_course(dir)
          write_repo_file(dir, "modules/01-core/01-managed.md", <<~MD)
            ---
            key: managed-media
            title: Managed Media
            lesson_type: video
            release_day: 0
            required: true
            ---

            <!-- block key=clip type=#{block_type} -->
            #{managed_body}
          MD

          error = assert_raises(CoursePackageMarkdownConverter::Error) do
            CoursePackageMarkdownConverter.new(dir).call
          end
          assert_includes error.message, "Media must be attached through the normal upload flow"
        end
      end
    end
  end

  test "writes output atomically with 0600 permissions and without following symlinks" do
    Dir.mktmpdir do |dir|
      output_path = File.join(dir, "private-package.json")
      CoursePackageMarkdownConverter.write_atomically(output_path, "{\"secret\":true}\n")

      assert File.file?(output_path)
      assert_equal 0o600, File.stat(output_path).mode & 0o777
      assert_equal "{\"secret\":true}\n", File.read(output_path)
      assert_equal [ "private-package.json" ], Dir.children(dir)

      # Pre-existing symlink at target path must not be followed
      victim = File.join(dir, "victim.txt")
      File.write(victim, "ORIGINAL_VICTIM")
      symlink_target = File.join(dir, "linked-output.json")
      File.symlink(victim, symlink_target)

      CoursePackageMarkdownConverter.write_atomically(symlink_target, "{\"replaced\":true}\n")
      assert_equal "ORIGINAL_VICTIM", File.read(victim)
      refute File.symlink?(symlink_target)
      assert_equal 0o600, File.stat(symlink_target).mode & 0o777
      assert_equal "{\"replaced\":true}\n", File.read(symlink_target)
    end
  end

  test "preserves leading indentation in bodies and solutions and checks length after trimming blank lines" do
    Dir.mktmpdir do |dir|
      write_minimal_course(dir)
      write_repo_file(dir, "modules/01-core/01-indented.md", <<~MD)
        ---
        key: indented-lesson
        title: Indented Code
        lesson_type: exercise
        release_day: 0
        required: true
        ---


            def starter():
                return 1


        <!-- solution -->


            def starter():
                return 42


      MD

      write_repo_file(dir, "modules/01-core/02-file-sol.md", <<~MD)
        ---
        key: indented-file-sol
        title: Indented File Solution
        lesson_type: exercise
        release_day: 0
        required: true
        ---

            x = 10
            print(x)
      MD
      write_repo_file(dir, "solutions/indented-file-sol.md", "\n\n    x = 20\n        # indented comment\n\n")

      package = CoursePackageMarkdownConverter.new(dir).call
      lessons = package.dig("modules", 0, "lessons")

      first_block = lessons[0].dig("blocks", 0)
      assert_equal "    def starter():\n        return 1", first_block["body"]
      assert_equal "    def starter():\n        return 42", first_block["solution"]

      second_block = lessons[1].dig("blocks", 0)
      assert_equal "    x = 10\n    print(x)", second_block["body"]
      assert_equal "    x = 20\n        # indented comment", second_block["solution"]
    end

    # Exact 100,000-char body surrounded by blank lines passes; 100,001 emitted chars fails
    Dir.mktmpdir do |dir|
      write_minimal_course(dir)
      exact_body = "    " + ("a" * (CoursePackageMarkdownConverter::TEXT_LIMIT - 4))
      write_repo_file(dir, "modules/01-core/01-exact.md", "---\nkey: exact\ntitle: Exact\nlesson_type: reading\nrelease_day: 0\nrequired: true\n---\n\n\n#{exact_body}\n\n\n")

      package = CoursePackageMarkdownConverter.new(dir).call
      assert_equal exact_body, package.dig("modules", 0, "lessons", 0, "blocks", 0, "body")
      assert_equal CoursePackageMarkdownConverter::TEXT_LIMIT, package.dig("modules", 0, "lessons", 0, "blocks", 0, "body").length

      over_body = "    " + ("a" * (CoursePackageMarkdownConverter::TEXT_LIMIT - 3))
      write_repo_file(dir, "modules/01-core/01-exact.md", "---\nkey: exact\ntitle: Exact\nlesson_type: reading\nrelease_day: 0\nrequired: true\n---\n\n#{over_body}\n")

      error = assert_raises(CoursePackageMarkdownConverter::Error) do
        CoursePackageMarkdownConverter.new(dir).call
      end
      assert_includes error.message, "exceeds maximum length"
    end
  end

  test "reports clean path:line diagnostics for YAML aliases and clean CLI stderr for malformed flags" do
    Dir.mktmpdir do |dir|
      write_repo_file(dir, "course.yml", <<~YAML)
        key: &course_key alias-course
        revision: "2026-10-04"
        title: *course_key
        total_weeks: 1
      YAML

      error = assert_raises(CoursePackageMarkdownConverter::Error) do
        CoursePackageMarkdownConverter.new(dir).call
      end
      assert_includes error.message, "course.yml:1"
      assert_includes error.message, "YAML aliases are not allowed"
    end

    Dir.mktmpdir do |dir|
      write_minimal_course(dir)
      write_repo_file(dir, "modules/01-core/01-alias.md", <<~MD)
        ---
        key: &k alias-lesson
        title: *k
        lesson_type: reading
        release_day: 0
        required: true
        ---
        Body
      MD

      error = assert_raises(CoursePackageMarkdownConverter::Error) do
        CoursePackageMarkdownConverter.new(dir).call
      end
      assert_includes error.message, "modules/01-core/01-alias.md:2"
      assert_includes error.message, "YAML aliases are not allowed"
    end

    cli = Rails.root.join("..", "scripts", "course-package-convert").to_s
    [ [ "--dry-run=yes", "." ], [ "--compact=true", "." ], [ "--unknown-flag", "." ] ].each do |args|
      _stdout, stderr, status = Open3.capture3(cli, *args)
      refute status.success?
      assert_equal 2, status.exitstatus
      assert_includes stderr, "Error:"
      assert_includes stderr, "Usage: scripts/course-package-convert"
      refute_includes stderr, "OptionParser::"
      refute_includes stderr, ".rb:"
    end
  end

  private

  def with_sample_repo
    Dir.mktmpdir do |dir|
      write_repo_file(dir, "course.yml", <<~YAML)
        key: python-fundamentals
        revision: "2026-10-04"
        title: Python Fundamentals
        description: Hands-on Python practice for beginners.
        total_weeks: 3
      YAML

      write_repo_file(dir, "modules/01-core/module.yml", <<~YAML)
        key: core
        title: Python Core
        description: Variables, functions, and control flow.
        total_days: 21
        schedule_days: daily
      YAML

      write_repo_file(dir, "modules/01-core/README.md", "# Module README (ignored)\n")

      write_repo_file(dir, "modules/01-core/01-read-a-value.md", <<~MD)
        ---
        key: lesson-1
        title: Read a value
        lesson_type: video
        release_day: 1
        required: true
        ---

        <!-- block key=video type=video -->

        <!-- block key=instructions type=text title="Predict what happens" -->
        Predict then run. Example markdown inside a fence stays literal:

        ```markdown
        <!-- block key=fake type=text -->
        <!-- solution -->
        ```

        <!-- block key=practice type=exercise filename=hello.py submission_type=text_submission -->
        Explain what prints when `name` changes.

        <!-- solution -->
        Line 2 reassigns `name` before printing.
      MD

      write_repo_file(dir, "modules/01-core/02-exercise-1.md", <<~MD)
        ---
        key: exercise-1
        title: Sum two numbers
        lesson_type: exercise
        release_day: 1
        required: true
        filename: sum.py
        submission_type: text_submission
        ---
        Write a function `add(a, b)`.
      MD
      write_repo_file(dir, "solutions/exercise-1.md", <<~MD)
        def add(a, b):
            return a + b
      MD

      write_repo_file(dir, "modules/01-core/03-checkpoint.md", <<~MD)
        ---
        key: checkpoint-1
        title: Week 1 Checkpoint
        lesson_type: checkpoint
        release_day: 2
        required: true
        ---
        Confirm you can run scripts locally.
      MD

      write_repo_file(dir, "modules/02-project/module.yml", <<~YAML)
        key: capstone-project
        title: Capstone Project
        description: Apply everything in a small project.
        total_days: 14
        schedule_days: weekdays
        module_type: recording
      YAML

      write_repo_file(dir, "modules/02-project/01-budget-tracker.md", <<~MD)
        ---
        key: budget-tracker
        title: CLI Budget Tracker
        lesson_type: project
        release_day: 0
        required: true
        blocks:
          brief:
            submission_type: repo_and_live_url_submission
            solution_file: solutions/budget-guide.md
            rubric:
              title: Budget Tracker Rubric
              description: Public acceptance criteria for learners and staff.
              criteria:
                - title: Accurate totals
                  description: Calculates income, expenses, and net balance.
                - title: Clear README
                  description: Explains how to install and run the CLI.
        ---

        <!-- block key=walkthrough type=video -->

        <!-- block key=brief type=exercise -->
        Build a CLI budget tracker from the starter CSV.
      MD
      write_repo_file(dir, "solutions/budget-guide.md", "Private instructor grading guide.\n")

      yield dir
    end
  end

  def write_minimal_course(dir, schedule_days: "daily")
    write_repo_file(dir, "course.yml", <<~YAML)
      key: sample-course
      revision: "2026-10-04"
      title: Sample Course
      total_weeks: 1
    YAML

    write_repo_file(dir, "modules/01-core/module.yml", <<~YAML)
      key: core
      title: Core
      total_days: 7
      schedule_days: #{schedule_days}
    YAML
  end

  def minimal_lesson(key:, release_day: 0)
    <<~MD
      ---
      key: #{key}
      title: Lesson #{key}
      lesson_type: reading
      release_day: #{release_day}
      required: true
      ---
      Lesson body for #{key}.
    MD
  end

  def write_repo_file(root, rel_path, content)
    full = File.join(root, rel_path)
    FileUtils.mkdir_p(File.dirname(full))
    File.write(full, content)
  end
end
