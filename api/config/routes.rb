Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check
  get "health", to: proc { [200, { "Content-Type" => "application/json" }, ['{"status":"ok"}']] }
  get "debug/auth", to: "debug#auth"

  namespace :api do
    namespace :v1 do
      # Auth
      post "sessions", to: "sessions#create"

      # Profile (current user)
      get "profile", to: "profile#show"
      patch "profile", to: "profile#update"

      # Dashboard
      get "dashboard", to: "dashboard#show"

      # Users (admin)
      resources :users, only: [:index, :show, :update]

      # Curricula with nested modules
      resources :curricula, only: [:index, :show, :create, :update, :destroy] do
        resources :modules, only: [:index, :create]
      end

      # Modules (shallow) with nested lessons
      resources :modules, only: [:show, :update, :destroy] do
        resources :lessons, only: [:index, :create]
      end

      # Lessons (shallow) with nested content blocks
      resources :lessons, only: [:show, :update, :destroy] do
        resources :content_blocks, only: [:index, :create]
      end

      # Content blocks (shallow)
      resources :content_blocks, only: [:show, :update, :destroy]

      # Cohorts with nested enrollments
      resources :cohorts, only: [:index, :show, :create, :update, :destroy] do
        resources :enrollments, only: [:index, :create]
      end

      # Enrollments (shallow)
      resources :enrollments, only: [:show, :update, :destroy]

      # Progress
      get "progress", to: "progress#index"
      patch "progress", to: "progress#update"
      get "progress/student/:user_id", to: "progress#student"

      # Submissions
      resources :submissions, only: [:index, :show, :create, :update] do
        member do
          patch :grade
        end
      end
    end
  end
end
