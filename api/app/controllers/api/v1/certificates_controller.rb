module Api
  module V1
    class CertificatesController < ApplicationController
      def show
        response.set_header("Cache-Control", "no-store")
        code = params[:code].to_s
        certificate = Certificate.find_by(code: code) if Certificate::CODE_FORMAT.match?(code)
        return render json: { error: "Certificate not found" }, status: :not_found unless certificate

        render json: { certificate: certificate.verification_json }
      end
    end
  end
end
