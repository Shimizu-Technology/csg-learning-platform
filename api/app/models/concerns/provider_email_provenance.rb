# Preserve the provider request shape when a legacy send is retried.
module ProviderEmailProvenance
  extend ActiveSupport::Concern

  APPLICATION = "csg_learn".freeze

  # The marker a new row gets. Bulk inserts, which skip before_create, set it from here.
  def self.marker
    # Enable only after every sender can read persisted markers.
    ENV["EMAIL_APPLICATION_PROVENANCE_ENABLED"] == "true" ? APPLICATION : nil
  end

  included do
    attr_readonly :email_application
    validates :email_application, inclusion: { in: [ APPLICATION ] }, allow_nil: true
    before_create :identify_email_application
  end

  def provider_application_tags
    return {} unless email_application == APPLICATION

    { tags: [ { name: "application", value: APPLICATION } ] }
  end

  private

  def identify_email_application
    self.email_application = ProviderEmailProvenance.marker
  end
end
