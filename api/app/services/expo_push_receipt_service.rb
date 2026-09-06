require "json"
require "net/http"
require "openssl"

class ExpoPushReceiptService
  ENDPOINT = URI("https://exp.host/--/api/v2/push/getReceipts")
  OPEN_TIMEOUT = 3
  READ_TIMEOUT = 5

  class RetryableError < StandardError; end

  def check(receipt_requests)
    requests = normalize_requests(receipt_requests)
    return [] if requests.empty?

    response = post({ ids: requests.map { |request| request.fetch("receipt_id") } }.to_json)
    if response.code.to_i == 429 || response.code.to_i >= 500
      raise RetryableError, "Expo receipt request failed with HTTP #{response.code}"
    end
    unless response.is_a?(Net::HTTPSuccess)
      Rails.logger.warn("[ExpoPushReceipt] request failed with HTTP #{response.code}")
      return []
    end

    receipts = JSON.parse(response.body).fetch("data", {})
    raise RetryableError, "Expo receipt response did not include a receipt map" unless receipts.is_a?(Hash)

    tokens = MobilePushToken.where(id: requests.map { |request| request.fetch("mobile_push_token_id") }).index_by(&:id)

    requests.filter_map do |request|
      receipt_id = request.fetch("receipt_id")
      receipt = receipts[receipt_id]
      next request unless receipt.is_a?(Hash)

      error = receipt.dig("details", "error")
      token = tokens[request.fetch("mobile_push_token_id")]
      if error == "DeviceNotRegistered"
        token&.mark_failed!
      elsif receipt["status"] == "error"
        Rails.logger.warn("[ExpoPushReceipt] delivery error receipt_id=#{receipt_id} token_id=#{token&.id || 'missing'} error=#{error || 'unknown'}")
      end
      nil
    end
  rescue JSON::ParserError, KeyError, OpenSSL::SSL::SSLError, SocketError, SystemCallError, Timeout::Error => e
    raise RetryableError, "Expo receipt lookup failed: #{e.class} #{e.message}"
  end

  private

  def normalize_requests(receipt_requests)
    Array(receipt_requests).filter_map do |request|
      receipt_id = request["receipt_id"].to_s
      token_id = request["mobile_push_token_id"].to_i
      { "receipt_id" => receipt_id, "mobile_push_token_id" => token_id } if receipt_id.present? && token_id.positive?
    end.uniq { |request| request.fetch("receipt_id") }
  end

  def post(body)
    connection = Net::HTTP.new(ENDPOINT.host, ENDPOINT.port)
    connection.use_ssl = true
    connection.open_timeout = OPEN_TIMEOUT
    connection.read_timeout = READ_TIMEOUT
    request = Net::HTTP::Post.new(ENDPOINT.request_uri, "Content-Type" => "application/json", "Accept" => "application/json")
    request["Authorization"] = "Bearer #{ENV.fetch('EXPO_ACCESS_TOKEN')}" if ENV["EXPO_ACCESS_TOKEN"].present?
    request.body = body
    connection.start { |http| http.request(request) }
  end
end
