require "test_helper"
require "tempfile"

class VoiceAudioInspectionTest < ActiveSupport::TestCase
  test "accepts a verified m4a and reads its movie duration" do
    with_upload(m4a_bytes(duration_seconds: 12.3)) do |upload|
      result = VoiceAudioInspection.call(upload)
      assert_equal 12.3, result.fetch(:duration_seconds)
      assert_equal "audio/mp4", result.fetch(:content_type)
      assert_equal "m4a", result.fetch(:extension)
    end

    with_upload(m4a_bytes(duration_seconds: 300), content_type: "audio/mp4;codecs=mp4a.40.2") do |upload|
      result = VoiceAudioInspection.call(upload, duration_seconds: 999)
      assert_equal 300.0, result.fetch(:duration_seconds)
      assert_equal "audio/mp4", result.fetch(:content_type)
      assert_equal "m4a", result.fetch(:extension)
    end
  end

  test "accepts webm with container duration and rejects overlong container duration" do
    with_upload(webm_bytes(duration_seconds: 14.6), content_type: "audio/webm;codecs=opus", filename: "voice.webm") do |upload|
      result = VoiceAudioInspection.call(upload, duration_seconds: 500)
      assert_equal 14.6, result.fetch(:duration_seconds)
      assert_equal "audio/webm", result.fetch(:content_type)
      assert_equal "webm", result.fetch(:extension)
    end

    with_upload(webm_bytes(duration_seconds: 301.0), content_type: "audio/webm", filename: "voice.webm") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: 10) }
      assert_equal "Recordings must be 5 minutes or shorter.", error.message
    end
  end

  test "accepts streamed webm without container duration when bounded duration_seconds is provided" do
    bytes = webm_bytes(duration_seconds: nil)

    with_upload(bytes, content_type: "audio/webm;codecs=opus", filename: "voice.webm") do |upload|
      result = VoiceAudioInspection.call(upload, duration_seconds: "18.24")
      assert_equal 18.2, result.fetch(:duration_seconds)
      assert_equal "audio/webm", result.fetch(:content_type)
      assert_equal "webm", result.fetch(:extension)
    end

    with_upload(bytes, content_type: "audio/webm", filename: "voice.webm") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload) }
      assert_equal "The recording duration could not be verified.", error.message
    end

    with_upload(bytes, content_type: "audio/webm", filename: "voice.webm") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: "0") }
      assert_equal "The recording duration could not be verified.", error.message
    end

    with_upload(bytes, content_type: "audio/webm", filename: "voice.webm") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: "300.6") }
      assert_equal "Recordings must be 5 minutes or shorter.", error.message
    end
  end

  test "accepts valid ogg with bounded duration and rejects invalid or overlong ogg" do
    ogg_bytes = "OggS\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00".b

    with_upload(ogg_bytes, content_type: "audio/ogg;codecs=opus", filename: "voice.ogg") do |upload|
      result = VoiceAudioInspection.call(upload, duration_seconds: 22.5)
      assert_equal 22.5, result.fetch(:duration_seconds)
      assert_equal "audio/ogg", result.fetch(:content_type)
      assert_equal "ogg", result.fetch(:extension)
    end

    with_upload("not ogg", content_type: "audio/ogg", filename: "voice.ogg") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: 5) }
      assert_equal "The recording is not a valid Ogg file.", error.message
    end

    with_upload(ogg_bytes, content_type: "audio/ogg", filename: "voice.ogg") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: 301) }
      assert_equal "Recordings must be 5 minutes or shorter.", error.message
    end

    with_upload(ogg_bytes, content_type: "audio/ogg", filename: "voice.ogg") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: "NaN") }
      assert_equal "The recording duration could not be verified.", error.message
    end
  end

  test "rejects forged, oversized, and overlong recordings" do
    with_upload("not an m4a") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload) }
      assert_equal "The recording is not a valid M4A file.", error.message
    end

    with_upload("not a webm", content_type: "audio/webm", filename: "voice.webm") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: 5) }
      assert_equal "The recording is not a valid WebM file.", error.message
    end

    with_upload(m4a_bytes(duration_seconds: 301)) do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload) }
      assert_equal "Recordings must be 5 minutes or shorter.", error.message
    end

    oversize = "\x1A\x45\xDF\xA3".b + ("\x00".b * VoiceAudioInspection::MAX_BYTES)
    with_upload(oversize, content_type: "audio/webm", filename: "voice.webm") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: 5) }
      assert_equal "The recording is too large.", error.message
    end
  end

  test "accepts an opaque mobile upload only when the filename and signature match" do
    with_upload(m4a_bytes(duration_seconds: 2), content_type: "application/octet-stream") do |upload|
      assert_equal 2.0, VoiceAudioInspection.call(upload).fetch(:duration_seconds)
    end
    with_upload(m4a_bytes(duration_seconds: 2), content_type: "audio/webm") do |upload|
      assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: 2) }
    end
  end

  private

  def with_upload(bytes, content_type: "audio/mp4", filename: "voice.m4a")
    tempfile = Tempfile.new([ "voice", File.extname(filename) ])
    tempfile.binmode
    tempfile.write(bytes)
    tempfile.rewind
    upload = ActionDispatch::Http::UploadedFile.new(tempfile: tempfile, filename: filename, type: content_type)
    yield upload
  ensure
    tempfile&.close!
  end

  def m4a_bytes(duration_seconds:)
    timescale = 1_000
    mvhd_payload = [ 0, 0, 0, 0, 0, 0, timescale, (duration_seconds * timescale).round ].pack("C4N4")
    box("ftyp", "M4A \0\0\0\0M4A isom") + box("moov", box("mvhd", mvhd_payload))
  end

  def webm_bytes(duration_seconds:, timecode_scale: 1_000_000)
    ebml_header = ebml_element("\x1A\x45\xDF\xA3".b, ebml_element("\x42\x82".b, "webm".b))
    info_children = ebml_element("\x2A\xD7\xB1".b, [ timecode_scale ].pack("N"))
    if duration_seconds
      ticks = (duration_seconds.to_f * 1_000_000_000.0) / timecode_scale
      info_children += ebml_element("\x44\x89".b, [ ticks ].pack("G"))
    end
    info = ebml_element("\x15\x49\xA9\x66".b, info_children)
    # Segment with unknown size (0x01FFFFFFFFFFFFFF), matching streamed Chrome MediaRecorder output.
    segment = "\x18\x53\x80\x67".b + "\x01\xFF\xFF\xFF\xFF\xFF\xFF\xFF".b + info
    ebml_header + segment
  end

  def ebml_element(id_bytes, payload)
    raise "payload too large for test helper" if payload.bytesize >= 127

    id_bytes + [ 0x80 | payload.bytesize ].pack("C") + payload.b
  end

  def box(type, payload)
    [ payload.bytesize + 8 ].pack("N") + type + payload
  end
end
