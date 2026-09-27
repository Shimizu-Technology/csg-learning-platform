module Api
  module V1
    class CourseCheckoutWebhooksController < ApplicationController
      def create
        return head :not_found unless CourseCheckout.webhook_ready?

        event = Stripe::Webhook.construct_event(request.raw_post, request.headers["Stripe-Signature"], ENV.fetch("STRIPE_WEBHOOK_SECRET"))
        if %w[checkout.session.completed checkout.session.async_payment_succeeded].include?(event.type)
          CoursePurchaseFulfillment.fulfill!(event.data.object)
        elsif event.type == "checkout.session.async_payment_failed"
          CoursePurchaseFulfillment.payment_failed!(event.data.object)
        elsif event.type == "charge.refunded"
          charge = event.data.object
          if charge.amount_refunded >= charge.amount
            CoursePurchaseFulfillment.revoke!(payment_intent_id: charge.payment_intent, status: "refunded")
          end
        elsif event.type == "charge.dispute.created"
          charge = CourseCheckout.client.v1.charges.retrieve(event.data.object.charge)
          CoursePurchaseFulfillment.revoke!(payment_intent_id: charge.payment_intent, status: "disputed")
        end
        head :ok
      rescue JSON::ParserError, Stripe::SignatureVerificationError
        head :bad_request
      end
    end
  end
end
