require "test_helper"
require "tempfile"

class VoiceAudioInspectionTest < ActiveSupport::TestCase
  test "accepts a verified m4a and reads its movie duration" do
    with_upload(m4a_bytes(duration_seconds: 12.3)) do |upload|
      result = VoiceAudioInspection.call(upload)
      assert_equal 12.3, result.fetch(:duration_seconds)
      assert_equal "audio/mp4", result.fetch(:content_type)
    end
  end

  test "rejects forged and overlong recordings" do
    with_upload("not an m4a") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload) }
      assert_equal "The recording is not a valid M4A file.", error.message
    end

    with_upload(m4a_bytes(duration_seconds: 91)) do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload) }
      assert_equal "Recordings must be 90 seconds or shorter.", error.message
    end
  end

  test "accepts an opaque mobile upload only when the filename and signature are m4a" do
    with_upload(m4a_bytes(duration_seconds: 2), content_type: "application/octet-stream") do |upload|
      assert_equal 2.0, VoiceAudioInspection.call(upload).fetch(:duration_seconds)
    end
    with_upload(m4a_bytes(duration_seconds: 2), content_type: "audio/webm") do |upload|
      assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload) }
    end
  end

  private

  def with_upload(bytes, content_type: "audio/mp4")
    tempfile = Tempfile.new([ "voice", ".m4a" ])
    tempfile.binmode
    tempfile.write(bytes)
    tempfile.rewind
    upload = ActionDispatch::Http::UploadedFile.new(tempfile: tempfile, filename: "voice.m4a", type: content_type)
    yield upload
  ensure
    tempfile&.close!
  end

  def m4a_bytes(duration_seconds:)
    timescale = 1_000
    mvhd_payload = [ 0, 0, 0, 0, 0, 0, timescale, (duration_seconds * timescale).round ].pack("C4N4")
    box("ftyp", "M4A \0\0\0\0M4A isom") + box("moov", box("mvhd", mvhd_payload))
  end

  def box(type, payload)
    [ payload.bytesize + 8 ].pack("N") + type + payload
  end
end
