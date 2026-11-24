module Api
  module V1
    class SchoolIdentitiesController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :require_admin!

      def show
        brand = SchoolBrand.current
        render json: {
          school_identity: {
            name: brand.name,
            product_name: brand.product_name,
            abbreviation: brand.abbreviation,
            short_name: brand.short_name,
            support_email: brand.support_email,
            email_sender: SchoolBrand.email_sender,
            sender_name_override: brand.sender_name,
            time_zone: Rails.application.config.x.school.time_zone,
            time_zone_label: Rails.application.config.x.school.time_zone_label,
            site_url: brand.site_url,
            app_url: brand.app_url,
            frontend_origin: FrontendUrlResolver.resolve
          }
        }
      end
    end
  end
end
