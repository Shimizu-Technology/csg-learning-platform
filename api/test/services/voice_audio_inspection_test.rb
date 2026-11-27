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

  test "derives duration from webm cluster timeline when info duration is omitted and ignores client claims" do
    streamed = webm_bytes(duration_seconds: nil, cluster_timestamps_ms: [ 0, 9_000, 18_240 ])

    with_upload(streamed, content_type: "audio/webm;codecs=opus", filename: "voice.webm") do |upload|
      result = VoiceAudioInspection.call(upload, duration_seconds: "999")
      assert_equal 18.2, result.fetch(:duration_seconds)
      assert_equal "audio/webm", result.fetch(:content_type)
      assert_equal "webm", result.fetch(:extension)
    end

    overlong_streamed = webm_bytes(duration_seconds: nil, cluster_timestamps_ms: [ 0, 301_000 ])
    with_upload(overlong_streamed, content_type: "audio/webm", filename: "voice.webm") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: "10") }
      assert_equal "Recordings must be 5 minutes or shorter.", error.message
    end

    no_timeline = webm_bytes(duration_seconds: nil, cluster_timestamps_ms: [])
    with_upload(no_timeline, content_type: "audio/webm", filename: "voice.webm") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: "10") }
      assert_equal "The recording duration could not be verified.", error.message
    end

    malformed = "\x1A\x45\xDF\xA3\x84\x42\x82\x84webm\xFF\xFF".b
    with_upload(malformed, content_type: "audio/webm", filename: "voice.webm") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: "10") }
      assert_equal "The recording is not a valid WebM file.", error.message
    end
  end

  test "validates ogg container pages and granule timeline and rejects truncated or overlong ogg" do
    valid_ogg = ogg_opus_bytes(duration_seconds: 22.5)

    with_upload(valid_ogg, content_type: "audio/ogg;codecs=opus", filename: "voice.ogg") do |upload|
      result = VoiceAudioInspection.call(upload, duration_seconds: 999)
      assert_equal 22.5, result.fetch(:duration_seconds)
      assert_equal "audio/ogg", result.fetch(:content_type)
      assert_equal "ogg", result.fetch(:extension)
    end

    overlong_ogg = ogg_opus_bytes(duration_seconds: 301.0)
    with_upload(overlong_ogg, content_type: "audio/ogg", filename: "voice.ogg") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: 5) }
      assert_equal "Recordings must be 5 minutes or shorter.", error.message
    end

    truncated_ogg = "OggS\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00".b
    with_upload(truncated_ogg, content_type: "audio/ogg", filename: "voice.ogg") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: 5) }
      assert_equal "The recording is not a valid Ogg file.", error.message
    end

    with_upload("not ogg", content_type: "audio/ogg", filename: "voice.ogg") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: 5) }
      assert_equal "The recording is not a valid Ogg file.", error.message
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

  def webm_bytes(duration_seconds:, timecode_scale: 1_000_000, cluster_timestamps_ms: [])
    ebml_header = ebml_element("\x1A\x45\xDF\xA3".b, ebml_element("\x42\x82".b, "webm".b))
    info_children = ebml_element("\x2A\xD7\xB1".b, [ timecode_scale ].pack("N"))
    if duration_seconds
      ticks = (duration_seconds.to_f * 1_000_000_000.0) / timecode_scale
      info_children += ebml_element("\x44\x89".b, [ ticks ].pack("G"))
    end
    info = ebml_element("\x15\x49\xA9\x66".b, info_children)
    clusters = cluster_timestamps_ms.map do |ts_ms|
      ts_el = ebml_element("\xE7".b, [ ts_ms ].pack("N"))
      simple_block = ebml_element("\xA3".b, "\x81\x00\x00\x80\x01".b)
      ebml_element("\x1F\x43\xB6\x75".b, ts_el + simple_block)
    end.join.b
    segment = "\x18\x53\x80\x67".b + "\x01\xFF\xFF\xFF\xFF\xFF\xFF\xFF".b + info + clusters
    ebml_header + segment
  end

  def ogg_opus_bytes(duration_seconds:, pre_skip: 312)
    opus_head = "OpusHead".b + [ 1, 1, pre_skip, 48_000, 0, 0 ].pack("CCvVvC")
    granule = pre_skip + (duration_seconds.to_f * 48_000).round
    ogg_page(header_type: 0x02, granule: 0, serial: 1, sequence: 0, payload: opus_head) +
      ogg_page(header_type: 0x04, granule: granule, serial: 1, sequence: 1, payload: "\xFC\x01\x02\x03".b)
  end

  def ogg_page(header_type:, granule:, serial:, sequence:, payload:)
    "OggS".b +
      [ 0, header_type, granule, serial, sequence, 0, 1, payload.bytesize ].pack("CCq<VVVCC") +
      payload
  end

  def ebml_element(id_bytes, payload)
    size = payload.bytesize
    size_bytes = if size < 0x7F
      [ 0x80 | size ].pack("C")
    else
      [ 0x4000 | size ].pack("n")
    end
    id_bytes + size_bytes + payload
  end

  def box(type, payload)
    [ payload.bytesize + 8 ].pack("N") + type.b + payload.b
  end
end
