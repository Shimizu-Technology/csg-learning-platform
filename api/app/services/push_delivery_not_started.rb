# Raised by a push service after it has recorded every outcome, when its
# delivery deadline stopped it before any request for some notifications had
# started. Nothing was sent for those notifications, so they are safe to send
# again; a request that started and then ran out of time is uncertain and is
# never listed here.
class PushDeliveryNotStarted < StandardError
  attr_reader :provider, :notification_ids

  def initialize(provider:, notification_ids:)
    @provider = provider
    @notification_ids = notification_ids.uniq.sort
    super("#{provider} did not start delivery for notification_ids=#{@notification_ids.join(',')} before its deadline")
  end
end
