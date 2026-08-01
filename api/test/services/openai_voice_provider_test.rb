require "test_helper"
require "tempfile"

class OpenaiVoiceProviderTest < ActiveSupport::TestCase
  test "sends m4a with the dedicated model and parses the faithful transcript" do
    provider = FakeOpenaiVoiceProvider.new
    with_upload("m4a bytes") do |upload|
      assert_equal "I am stuck on Rails.", provider.transcribe(upload)
    end

    request = provider.requests.first
    assert_equal "/v1/audio/transcriptions", request.fetch(:path)
    assert_includes request.fetch(:body), "gpt-4o-transcribe"
    assert_includes request.fetch(:body), "Code School of Guam"
    assert_includes request.fetch(:headers).fetch("Content-Type"), "multipart/form-data"
  end

  test "uses strict stored-false cleanup and parses its structured result" do
    provider = FakeOpenaiVoiceProvider.new
    result = provider.clean_up("i am stuck on rails")

    assert_equal "I am stuck on Rails.", result.fetch(:suggested_text)
    assert_empty result.fetch(:warnings)
    payload = JSON.parse(provider.requests.last.fetch(:body))
    assert_equal false, payload.fetch("store")
    assert_equal "none", payload.dig("reasoning", "effort")
    assert_equal "json_schema", payload.dig("text", "format", "type")
    assert_equal true, payload.dig("text", "format", "strict")
  end

  test "normalizes connection resets so callers can use their safe fallback" do
    provider = OpenaiVoiceProvider.new(api_key: "test-key")
    with_upload("m4a bytes") do |upload|
      with_singleton_method(Net::HTTP, :start, ->(*) { raise Errno::ECONNRESET }) do
        error = assert_raises(OpenaiVoiceProvider::ProviderError) { provider.transcribe(upload) }
        assert_equal "The voice service is temporarily unavailable. Try again.", error.message
      end
    end
  end

  test "normalizes TLS negotiation failures" do
    provider = OpenaiVoiceProvider.new(api_key: "test-key")
    with_upload("m4a bytes") do |upload|
      with_singleton_method(Net::HTTP, :start, ->(*) { raise OpenSSL::SSL::SSLError, "handshake failed" }) do
        assert_raises(OpenaiVoiceProvider::ProviderError) { provider.transcribe(upload) }
      end
    end
  end

  private

  def with_upload(bytes)
    tempfile = Tempfile.new([ "voice", ".m4a" ])
    tempfile.binmode
    tempfile.write(bytes)
    tempfile.rewind
    upload = ActionDispatch::Http::UploadedFile.new(tempfile: tempfile, filename: "voice.m4a", type: "audio/mp4")
    yield upload
  ensure
    tempfile&.close!
  end

  def with_singleton_method(target, name, replacement)
    original = target.method(name)
    target.define_singleton_method(name, replacement)
    yield
  ensure
    target.define_singleton_method(name, original)
  end

  class FakeOpenaiVoiceProvider < OpenaiVoiceProvider
    attr_reader :requests

    def initialize
      super(api_key: "test-key")
      @requests = []
    end

    private

    def request(path, body, headers)
      @requests << { path: path, body: body, headers: headers }
      response_body = if path == "/v1/audio/transcriptions"
        JSON.generate(text: "I am stuck on Rails.")
      else
        JSON.generate(output: [ { content: [ { type: "output_text", text: JSON.generate(suggested_text: "I am stuck on Rails.", warnings: []) } ] } ])
      end
      Struct.new(:body).new(response_body)
    end
  end
end
