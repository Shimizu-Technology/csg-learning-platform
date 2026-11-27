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

  test "accepts webm with container duration and rejects overlong or trackless webm" do
    with_upload(webm_bytes(duration_seconds: 14.6, cluster_timestamps_ms: [ 0 ]), content_type: "audio/webm;codecs=opus", filename: "voice.webm") do |upload|
      result = VoiceAudioInspection.call(upload, duration_seconds: 500)
      assert_equal 14.6, result.fetch(:duration_seconds)
      assert_equal "audio/webm", result.fetch(:content_type)
      assert_equal "webm", result.fetch(:extension)
    end

    # Info.Duration alone without an audio track and audio blocks must be rejected.
    with_upload(webm_bytes(duration_seconds: 14.6, cluster_timestamps_ms: []), content_type: "audio/webm", filename: "voice.webm") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload) }
      assert_equal "The recording is not a valid WebM file.", error.message
    end

    # Under-reported Info.Duration cannot hide an overlong cluster timeline, even when blocks precede Timestamp.
    with_upload(webm_bytes(duration_seconds: 10.0, cluster_timestamps_ms: [ 0, 301_000 ], block_before_timestamp: true), content_type: "audio/webm", filename: "voice.webm") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload) }
      assert_equal "Recordings must be 5 minutes or shorter.", error.message
    end

    # Malformed trailing data after Info.Duration must be rejected.
    corrupt_trailing = webm_bytes(duration_seconds: 14.6, cluster_timestamps_ms: [ 0 ]) + "\xFF\xFF".b
    with_upload(corrupt_trailing, content_type: "audio/webm", filename: "voice.webm") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload) }
      assert_equal "The recording is not a valid WebM file.", error.message
    end

    with_upload(webm_bytes(duration_seconds: 301.0, cluster_timestamps_ms: [ 0 ]), content_type: "audio/webm", filename: "voice.webm") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: 10) }
      assert_equal "Recordings must be 5 minutes or shorter.", error.message
    end
  end

  test "derives duration from webm cluster timeline including final block duration and rejects truncated streams" do
    streamed = webm_bytes(duration_seconds: nil, cluster_timestamps_ms: [ 0, 9_000, 18_240 ])

    with_upload(streamed, content_type: "audio/webm;codecs=opus", filename: "voice.webm") do |upload|
      result = VoiceAudioInspection.call(upload, duration_seconds: "999")
      # 18_240ms + 20ms final Opus frame = 18.26s -> 18.3s
      assert_equal 18.3, result.fetch(:duration_seconds)
      assert_equal "audio/webm", result.fetch(:content_type)
      assert_equal "webm", result.fetch(:extension)
    end

    # Final block duration counts toward the 5-minute ceiling (config 3 = 60ms -> 300.54s > 300.5s).
    overlong_by_final_block = webm_bytes(duration_seconds: nil, cluster_timestamps_ms: [ 0, 300_480 ], opus_toc: 0x18)
    with_upload(overlong_by_final_block, content_type: "audio/webm", filename: "voice.webm") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: "10") }
      assert_equal "Recordings must be 5 minutes or shorter.", error.message
    end

    no_blocks = webm_bytes(duration_seconds: nil, cluster_timestamps_ms: [])
    with_upload(no_blocks, content_type: "audio/webm", filename: "voice.webm") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: "10") }
      assert_equal "The recording is not a valid WebM file.", error.message
    end

    malformed = "\x1A\x45\xDF\xA3\x84\x42\x82\x84webm\xFF\xFF".b
    with_upload(malformed, content_type: "audio/webm", filename: "voice.webm") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: "10") }
      assert_equal "The recording is not a valid WebM file.", error.message
    end
  end

  test "validates ogg crc, headers, single logical stream, and granule timeline" do
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

    # Chained logical streams must be rejected explicitly.
    chained_ogg = ogg_opus_bytes(duration_seconds: 200.0, serial: 1) + ogg_opus_bytes(duration_seconds: 200.0, serial: 2)
    with_upload(chained_ogg, content_type: "audio/ogg", filename: "voice.ogg") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: 10) }
      assert_equal "The recording is not a valid Ogg file.", error.message
    end

    # Corrupted CRC checksum must be rejected.
    bad_crc_ogg = valid_ogg.dup
    bad_crc_ogg.setbyte(22, bad_crc_ogg.getbyte(22) ^ 0xFF)
    with_upload(bad_crc_ogg, content_type: "audio/ogg", filename: "voice.ogg") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: 5) }
      assert_equal "The recording is not a valid Ogg file.", error.message
    end

    # Nonzero initial granule (e.g., cropped/joined stream starting at 10 minutes) measures elapsed audio, not raw granule.
    cropped_ogg = ogg_opus_bytes(duration_seconds: 12.0, initial_granule_offset: 600 * 48_000)
    with_upload(cropped_ogg, content_type: "audio/ogg;codecs=opus", filename: "voice.ogg") do |upload|
      result = VoiceAudioInspection.call(upload)
      assert_equal 12.0, result.fetch(:duration_seconds)
    end

    # Malformed OpusTags with truncated vendor string length must be rejected.
    bad_tags_payload = "OpusTags".b + [ 999 ].pack("V") + "csg".b + [ 0 ].pack("V")
    bad_tags = ogg_page(header_type: 0x02, granule: 0, serial: 1, sequence: 0, payload: opus_head_payload(312)) +
      ogg_page(header_type: 0x00, granule: 0, serial: 1, sequence: 1, payload: bad_tags_payload) +
      ogg_page(header_type: 0x04, granule: 312 + 960, serial: 1, sequence: 2, payload: "\xFC\x01\x02\x03".b)
    with_upload(bad_tags, content_type: "audio/ogg", filename: "voice.ogg") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: 5) }
      assert_equal "The recording is not a valid Ogg file.", error.message
    end

    # Malformed OpusHead with invalid channel mapping family 0 + 3 channels must be rejected.
    bad_head = "OpusHead".b + [ 1, 3, 312, 48_000, 0, 0 ].pack("CCvVvC")
    bad_head_ogg = ogg_page(header_type: 0x02, granule: 0, serial: 1, sequence: 0, payload: bad_head) +
      ogg_page(header_type: 0x00, granule: 0, serial: 1, sequence: 1, payload: opus_tags_payload) +
      ogg_page(header_type: 0x04, granule: 312 + 960, serial: 1, sequence: 2, payload: "\xFC\x01\x02\x03".b)
    with_upload(bad_head_ogg, content_type: "audio/ogg", filename: "voice.ogg") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: 5) }
      assert_equal "The recording is not a valid Ogg file.", error.message
    end

    # Malformed OpusHead with nonzero mapping family where stream_count + coupled_count > 255 must be rejected.
    overflow_head = "OpusHead".b + [ 1, 2, 312, 48_000, 0, 1, 255, 1, 0, 1 ].pack("CCvVvCCCCC")
    overflow_head_ogg = ogg_page(header_type: 0x02, granule: 0, serial: 1, sequence: 0, payload: overflow_head) +
      ogg_page(header_type: 0x00, granule: 0, serial: 1, sequence: 1, payload: opus_tags_payload) +
      ogg_page(header_type: 0x04, granule: 312 + 960, serial: 1, sequence: 2, payload: "\xFC\x01\x02\x03".b)
    with_upload(overflow_head_ogg, content_type: "audio/ogg", filename: "voice.ogg") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: 5) }
      assert_equal "The recording is not a valid Ogg file.", error.message
    end

    # Opus packets exceeding RFC 6716's 120 ms cap (e.g. 3 x 60 ms = 180 ms) must be rejected.
    overlong_opus_packet = ogg_page(header_type: 0x02, granule: 0, serial: 1, sequence: 0, payload: opus_head_payload(312)) +
      ogg_page(header_type: 0x00, granule: 0, serial: 1, sequence: 1, payload: opus_tags_payload) +
      ogg_page(header_type: 0x04, granule: 312 + 8_640, serial: 1, sequence: 2, payload: "\x1B\x03\x00\x00\x00".b)
    with_upload(overlong_opus_packet, content_type: "audio/ogg", filename: "voice.ogg") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: 5) }
      assert_equal "The recording is not a valid Ogg file.", error.message
    end

    # Missing OpusTags comment header must be rejected.
    missing_tags = ogg_page(header_type: 0x02, granule: 0, serial: 1, sequence: 0, payload: opus_head_payload(312)) +
      ogg_page(header_type: 0x04, granule: 48_312, serial: 1, sequence: 1, payload: "\xFC\x01\x02\x03".b)
    with_upload(missing_tags, content_type: "audio/ogg", filename: "voice.ogg") do |upload|
      error = assert_raises(VoiceAudioInspection::InvalidAudio) { VoiceAudioInspection.call(upload, duration_seconds: 5) }
      assert_equal "The recording is not a valid Ogg file.", error.message
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

  def webm_bytes(duration_seconds:, timecode_scale: 1_000_000, cluster_timestamps_ms: [], opus_toc: 0xFC, block_before_timestamp: false)
    ebml_header = ebml_element("\x1A\x45\xDF\xA3".b, ebml_element("\x42\x82".b, "webm".b))
    info_children = ebml_element("\x2A\xD7\xB1".b, [ timecode_scale ].pack("N"))
    if duration_seconds
      ticks = (duration_seconds.to_f * 1_000_000_000.0) / timecode_scale
      info_children += ebml_element("\x44\x89".b, [ ticks ].pack("G"))
    end
    info = ebml_element("\x15\x49\xA9\x66".b, info_children)
    track_entry = ebml_element(
      "\xAE".b,
      ebml_element("\xD7".b, "\x01".b) +
        ebml_element("\x83".b, "\x02".b) +
        ebml_element("\x86".b, "A_OPUS".b)
    )
    tracks = ebml_element("\x16\x54\xAE\x6B".b, track_entry)
    clusters = cluster_timestamps_ms.map do |ts_ms|
      ts_el = ebml_element("\xE7".b, [ ts_ms ].pack("N"))
      simple_block = ebml_element("\xA3".b, "\x81\x00\x00\x80".b + [ opus_toc, 0x01 ].pack("CC"))
      body = block_before_timestamp ? (simple_block + ts_el) : (ts_el + simple_block)
      ebml_element("\x1F\x43\xB6\x75".b, body)
    end.join.b
    segment = "\x18\x53\x80\x67".b + "\x01\xFF\xFF\xFF\xFF\xFF\xFF\xFF".b + info + tracks + clusters
    ebml_header + segment
  end

  def opus_head_payload(pre_skip)
    "OpusHead".b + [ 1, 1, pre_skip, 48_000, 0, 0 ].pack("CCvVvC")
  end

  def opus_tags_payload
    "OpusTags".b + [ 3 ].pack("V") + "csg".b + [ 0 ].pack("V")
  end

  def ogg_opus_bytes(duration_seconds:, pre_skip: 312, serial: 1, initial_granule_offset: 0)
    total_samples = pre_skip + (duration_seconds.to_f * 48_000).round
    # RFC 6716 code=1, config=3: two equal-sized 60 ms CBR frames (120 ms = 5,760 samples) in 3 bytes.
    packet_120ms = "\x19\x00\x00".b
    packet_count = (total_samples.to_f / 5_760).ceil
    packets = Array.new(packet_count, packet_120ms)

    pages = [
      ogg_page(header_type: 0x02, granule: 0, serial: serial, sequence: 0, payload: opus_head_payload(pre_skip)),
      ogg_page(header_type: 0x00, granule: 0, serial: serial, sequence: 1, payload: opus_tags_payload)
    ]

    seq = 2
    produced = 0
    slice_size = [ (packet_count / 2.0).ceil, 50 ].min.clamp(1, 50)
    packets.each_slice(slice_size).with_index do |slice, idx|
      last_page = (idx + 1) * slice_size >= packets.length
      produced += slice.length * 5_760
      page_granule = initial_granule_offset + (last_page ? total_samples : produced)
      pages << ogg_page_packets(header_type: last_page ? 0x04 : 0x00, granule: page_granule, serial: serial, sequence: seq, packets: slice)
      seq += 1
    end
    pages.join.b
  end

  def ogg_page(header_type:, granule:, serial:, sequence:, payload:)
    ogg_page_packets(header_type: header_type, granule: granule, serial: serial, sequence: sequence, packets: [ payload ])
  end

  def ogg_page_packets(header_type:, granule:, serial:, sequence:, packets:)
    lacing = packets.map(&:bytesize)
    body = packets.join.b
    raw = "OggS".b +
      [ 0, header_type, granule, serial, sequence, 0, lacing.length, *lacing ].pack("CCq<VVVC*") +
      body
    crc = ogg_crc(raw)
    raw[22, 4] = [ crc ].pack("V")
    raw
  end

  def ogg_crc(bytes)
    crc = 0
    bytes.each_byte do |byte|
      crc = ((crc << 8) & 0xFFFFFFFF) ^ VoiceAudioInspection::OGG_CRC_TABLE[((crc >> 24) ^ byte) & 0xFF]
    end
    crc
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
