# Preserve the provider request shape when a legacy send is retried.
module ProviderEmailProvenance
  extend ActiveSupport::Concern

  APPLICATION = "csg_learn".freeze

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
    # Enable only after every sender can read persisted markers.
    self.email_application = ENV["EMAIL_APPLICATION_PROVENANCE_ENABLED"] == "true" ? APPLICATION : nil
  end
end
