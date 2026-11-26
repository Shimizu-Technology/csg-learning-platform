require "zip"

# A folder of cohort items as one ZIP (CohortFilesController#export_zip).
# The controller decides what the viewer may read (for a paused learner, the
# version and doc state from before the pause) and passes plain entries, so
# no database transaction stays open while storage downloads run.
#
# - An upload is streamed from storage into the archive.
# - A Learn Doc becomes "<folder>/<title>.md".
# - A folder's links become "<folder>/Links.md", one Markdown bullet each.
#
# Names are cleaned so nothing can climb out of the archive or hide (no
# slashes, "..", control characters or leading dots) and made ASCII; two
# items with the same name become "name.ext" and "name (2).ext". Exports are
# capped at MAX_ITEMS items and MAX_BYTES, checked on the stored sizes before
# any download and again on the bytes actually read. Without storage,
# uploads are left out (with a README.txt saying so) as long as something
# else can be exported. Every byte written (uploads, docs, Links.md and the
# README) counts toward MAX_BYTES; callers load at most MAX_ITEMS + 1 rows
# (see too_many!).
class CohortFileExport
  MAX_ITEMS = 100
  MAX_BYTES = 100.megabytes
  CHUNK_BYTES = 64.kilobytes

  Entry = Struct.new(:kind, :folder, :title, :filename, :s3_key, :file_size, :content, :url, keyword_init: true)

  # A request that can't be exported, with the status to answer it with.
  class Problem < StandardError
    attr_reader :status

    def initialize(message, status: :unprocessable_entity)
      super(message)
      @status = status
    end
  end

  # The archive on disk, handed to Rack as the response body: read in
  # chunks, then closed and deleted (also when the response never starts).
  class Body
    def initialize(tempfile)
      @tempfile = tempfile
    end

    def size
      File.size(@tempfile.path)
    end

    def each
      File.open(@tempfile.path, "rb") do |io|
        while (chunk = io.read(CHUNK_BYTES))
          yield chunk
        end
      end
    ensure
      close
    end

    def close
      @tempfile.close!
    end
  end

  def self.too_many!
    raise Problem, "This has more than #{MAX_ITEMS} items. Download one folder at a time."
  end

  # `file` is a CohortFile; `shown` the file or CohortFileVersion to export;
  # `doc_state` the CohortFile::DocState for a doc.
  def self.entry_for(file, shown: file, doc_state: nil)
    case file.kind
    when "doc"
      state = doc_state || file.current_doc_state
      Entry.new(kind: "doc", folder: file.folder, title: state.title, content: state.content)
    when "link"
      Entry.new(kind: "link", folder: file.folder, title: file.title, url: file.external_url)
    else
      Entry.new(kind: "file", folder: file.folder, title: file.title, filename: shown.filename, s3_key: shown.s3_key, file_size: shown.file_size)
    end
  end

  # One path segment: ASCII, no separators, control characters, "..",
  # leading dots or reserved punctuation; `fallback` when nothing is left.
  def self.safe_segment(value, fallback)
    text = ActiveSupport::Inflector.transliterate(value.to_s.unicode_normalize(:nfkc).gsub(/[\p{Cc}\p{Cf}]/, ""), "-")
    text = text.gsub(%r{[/\\:*?"<>|]}, "-").gsub(/\.{2,}/, ".").squish.sub(/\A[.\s-]+/, "").sub(/[.\s]+\z/, "")
    text = text[0, 120].sub(/[.\s]+\z/, "")
    text.presence || fallback
  end

  def initialize(entries, storage: S3Service.configured?)
    @entries = entries
    @storage = storage
    @paths = Set.new
  end

  # The finished archive as a Body. Raises Problem; nothing is left on disk.
  def build!
    uploads, others = @entries.partition { |entry| entry.kind == "file" }
    raise Problem, "There's nothing to download here yet." if @entries.empty?
    self.class.too_many! if @entries.size > MAX_ITEMS
    raise Problem.new("File storage is unavailable, so these uploads can't be downloaded.", status: :service_unavailable) if !@storage && others.empty?

    uploads = [] unless @storage
    @bytes = 0
    planned = uploads.sum { |entry| entry.file_size.to_i } + others.sum { |entry| entry.content.to_s.bytesize }
    raise Problem, too_large if planned > MAX_BYTES

    tempfile = Tempfile.new([ "cohort-files", ".zip" ], binmode: true)
    begin
      write(tempfile.path, uploads, others, left_out: @storage ? 0 : @entries.count { |entry| entry.kind == "file" })
      Body.new(tempfile)
    rescue StandardError
      tempfile.close!
      raise
    end
  end

  private

  def write(path, uploads, others, left_out:)
    missing = []
    Zip::OutputStream.open(path) do |zip|
      uploads.each do |entry|
        zip.put_next_entry(unique_path(entry.folder, entry.filename))
        found = S3Service.stream_object(entry.s3_key) do |chunk|
          emit(zip, chunk)
        end
        missing << entry.filename unless found
      end
      others.select { |entry| entry.kind == "doc" }.each do |entry|
        zip.put_next_entry(unique_path(entry.folder, "#{self.class.safe_segment(entry.title, 'Untitled')}.md"))
        emit(zip, "# #{entry.title}\n\n#{entry.content.to_s.chomp}\n")
      end
      others.select { |entry| entry.kind == "link" }.group_by(&:folder).each do |folder, links|
        zip.put_next_entry(unique_path(folder, "Links.md"))
        emit(zip, "# Links\n\n#{links.map { |link| "- [#{link_label(link.title)}](#{link_target(link.url)})" }.join("\n")}\n")
      end
      notes = []
      notes << "#{left_out} uploaded #{left_out == 1 ? 'file was' : 'files were'} left out because file storage isn't set up yet." if left_out.positive?
      notes << "These uploads could not be found in storage: #{missing.join(', ')}." if missing.any?
      if notes.any?
        zip.put_next_entry(unique_path(nil, "README.txt"))
        emit(zip, "#{notes.join("\n")}\n")
      end
    end
  end

  # Writes into the current entry, counting it toward the size limit first.
  def emit(zip, data)
    @bytes += data.bytesize
    raise Problem, too_large if @bytes > MAX_BYTES

    zip.write(data)
  end

  def too_large
    "This is larger than #{MAX_BYTES / 1.megabyte} MB. Download one folder at a time."
  end

  # "<folder>/<name>", unique in the archive (case-insensitively).
  def unique_path(folder, name)
    directory = folder && self.class.safe_segment(folder, "General")
    base = self.class.safe_segment(name, "Untitled")
    extension = File.extname(base)
    stem = extension.present? && base.length > extension.length ? base.delete_suffix(extension) : base
    extension = "" if stem == base
    count = 1
    loop do
      candidate = [ directory, count == 1 ? base : "#{stem} (#{count})#{extension}" ].compact.join("/")
      return candidate if @paths.add?(candidate.downcase)

      count += 1
    end
  end

  # Link text on one line, with Markdown brackets escaped.
  def link_label(title)
    label = title.to_s.gsub(/[\p{Cc}\p{Cf}]/, " ").squish.presence || "Link"
    label.gsub(/([\\\[\]])/) { "\\#{::Regexp.last_match(1)}" }
  end

  # Links are validated https:// addresses (no spaces or angle brackets);
  # parentheses are encoded so they can't end the Markdown link early.
  def link_target(url)
    url.to_s.gsub("(", "%28").gsub(")", "%29")
  end
end
