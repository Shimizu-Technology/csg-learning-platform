// Generated from docs/openapi.json. DO NOT EDIT. Run npm run api:generate in web/.
export interface paths {
    "/api/v1/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotificationsResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/{id}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotificationResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/notifications/mark_all_read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MarkAllNotificationsReadResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/activity_events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ActivityEventsResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/help_requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["HelpRequestsResponse"];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["HelpRequestResponse"];
                    };
                };
                /** @description Successful response */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["HelpRequestResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/help_requests/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["HelpRequestResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["HelpRequestResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/recordings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RecordingsResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cohorts/{cohort_id}/recordings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    cohort_id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CohortRecordingsResponse"];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    cohort_id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RecordingResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/lessons/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LessonResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LessonResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/lessons/{id}/editor": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LessonResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/lessons/{id}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LessonResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/lessons/{id}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LessonResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ProgressListResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ProgressUpdateResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/submissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SubmissionsListResponse"];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SubmissionResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/submissions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SubmissionResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SubmissionResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/submissions/{id}/grade": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SubmissionResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/content_blocks/{id}/video_progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["VideoProgressInput"];
                };
            };
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["VideoProgressResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/content_blocks/{id}/video_stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["VideoStreamResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/watch_progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["WatchProgressInput"];
                };
            };
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["WatchProgressUpdateResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/cohorts/{cohort_id}/recordings/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                    cohort_id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RecordingResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        NotificationEntry: {
            destination: components["schemas"]["RecordDestination"] | null;
            destination_path: null | string;
            target_available: boolean;
            id: number;
            notification_type: string;
            title: string;
            body: null | string;
            path: string;
            read_at: null | string;
            created_at: string;
            actor: null | {
                id: number;
                full_name: string;
            };
            notifiable: {
                type: string;
                id: number;
            };
        };
        NotificationsResponse: {
            notifications: components["schemas"]["NotificationEntry"][];
            unread_count: number;
            meta: components["schemas"]["PaginationMeta"];
        };
        PaginationMeta: {
            page: number;
            per_page: number;
            total_count: number;
            total_pages: number;
            has_next_page: boolean;
            has_prev_page: boolean;
        };
        NotificationResponse: {
            notification: components["schemas"]["NotificationEntry"];
            unread_count: number;
        };
        MarkAllNotificationsReadResponse: {
            unread_count: number;
        };
        ActivityDestination: {
            id: null | string | number;
            context: {
                [key: string]: unknown;
            };
            anchor: {
                [key: string]: unknown;
            };
            /** @enum {string} */
            kind: "submission" | "lesson" | "recording";
            /** @description Present for lesson and recording destinations. */
            destination_path?: string;
            cohort_id: number;
            student_id: number;
            /** @description Present for lesson destinations. */
            lesson_id?: number;
            /** @description Present for lesson destinations. */
            content_block_id?: number;
            /** @description Present for submission destinations. */
            submission_id?: number;
            /** @description Present for recording destinations. */
            recording_id?: number;
        };
        ActivityEvent: {
            subject_user: {
                id: number;
                name: string;
                role: string;
            };
            destination: null | components["schemas"]["ActivityDestination"];
            id: number;
            event_type: string;
            actor: {
                id: number;
                name: string;
                role: string;
            };
            subject_user_id: number;
            cohort_id: null | number;
            cohort_name: null | string;
            record_type: null | string;
            record_id: null | number;
            record_label: null | string;
            /** @enum {string} */
            evidence: "server_record" | "player_reported";
            created_at: string;
        };
        ActivityEventsResponse: {
            recorded_since: null | string;
            activity_events: components["schemas"]["ActivityEvent"][];
            next_before_id: null | number;
        };
        HelpRequest: {
            id: number;
            cohort: {
                id: number;
                name: string;
            };
            context_type: components["schemas"]["HelpContextType"];
            context_source: components["schemas"]["HelpContextSource"];
            context_id: number;
            context_label: string;
            context_path: string;
            category: components["schemas"]["HelpCategory"];
            urgency: components["schemas"]["HelpUrgency"];
            status: components["schemas"]["HelpRequestStatus"];
            message: string;
            staff_response: null | string;
            acknowledged_at: null | string;
            resolved_at: null | string;
            canceled_at: null | string;
            created_at: string;
            updated_at: string;
            owner: null | {
                id: number;
                full_name: string;
            };
            /** @description Present for staff readers. */
            student?: {
                id: number;
                full_name: string;
                email: string;
            };
            destination: components["schemas"]["RecordDestination"] | null;
            context_destination: components["schemas"]["RecordDestination"] | null;
        };
        /** @enum {string} */
        HelpContextType: "lesson" | "recording" | "exercise";
        /** @enum {string} */
        HelpContextSource: "primary" | "legacy";
        /** @enum {string} */
        HelpCategory: "concept" | "technical" | "instructions" | "feedback" | "other";
        /** @enum {string} */
        HelpUrgency: "normal" | "urgent";
        /** @enum {string} */
        HelpRequestStatus: "open" | "acknowledged" | "resolved" | "canceled";
        HelpRequestsResponse: {
            help_requests: components["schemas"]["HelpRequest"][];
        };
        HelpRequestResponse: {
            help_request: components["schemas"]["HelpRequest"];
            /** @description Present on create or duplicate create. */
            created?: boolean;
            /** @description Present on update. */
            status_changed?: boolean;
        };
        LessonDetail: {
            /** @description Present for students with an enrollment. */
            capabilities?: components["schemas"]["LearnerCapabilities"];
            id: number;
            curriculum_id: number;
            /** @description Present for students with an enrollment. */
            cohort_id?: number;
            module_id: number;
            title: string;
            lesson_type: string;
            position: number;
            release_day: number;
            required: boolean;
            requires_submission: boolean;
            submission_type: string;
            content_blocks_count: number;
            archived_at: null | string;
            updated_at: string;
            objectives: components["schemas"]["LessonObjective"][];
            /** @description Present for students with an enrollment. */
            submission_window?: components["schemas"]["SubmissionWindowStatus"];
            content_blocks: components["schemas"]["ContentBlockSummary"][];
            prev_lesson: null | {
                id: number;
                title: string;
            };
            next_lesson: null | {
                id: number;
                title: string;
            };
            /** @description Present for students with an enrollment. */
            requires_github?: boolean;
            /** @description Present for students with an enrollment. */
            repository_name?: string | null;
        };
        LearnerCapabilities: {
            live_support: boolean;
            features: {
                [key: string]: boolean;
            };
            can_submit: boolean;
            read_only: boolean;
            /** @enum {string} */
            support_mode: "guided_help" | "course_question" | "none";
            support_expires_at: null | string;
            access_expires_at: null | string;
            support_instructor_id: null | number;
        };
        LessonObjective: {
            alignment_id: number;
            content_block_id: null | number;
            content_block_title: null | string;
            id: number;
            code: string;
            title: string;
            description: null | string;
            success_criteria: string;
            active: boolean;
            /** @description Present in management responses; omitted from embedded learning responses. */
            alignment_count?: number;
        };
        SubmissionWindowStatus: {
            week_number: number;
            submissions_close_at: null | string;
            submissions_closed: boolean;
            /** @enum {string} */
            status: "open" | "scheduled" | "closed";
            /** @description Present in week summaries; omitted in lesson responses. */
            starts_on?: null | string;
            /** @description Present in week summaries; omitted in lesson responses. */
            ends_on?: null | string;
            /** @description Present in week summaries; omitted in lesson responses. */
            lessons_count?: number;
        };
        ContentBlockSummary: {
            id: number;
            block_type: string;
            position: number;
            title: null | string;
            body: null | string;
            video_url: null | string;
            filename: null | string;
            submission_type: null | string;
            effective_submission_type: null | string;
            submission_type_explicit: null | string;
            submission_config: {
                [key: string]: unknown;
            };
            metadata: {
                [key: string]: unknown;
            };
            s3_video_key: null | string;
            /** @description Present for staff readers. */
            s3_video_content_type?: null | string;
            /** @description Present for staff readers. */
            s3_video_size?: null | number;
            objective_ids: number[];
            rubric: null | components["schemas"]["Rubric"];
            knowledge_check: null | components["schemas"]["KnowledgeCheck"];
            /** @description Present for staff readers. */
            solution?: null | string;
            /** @description Present for students with saved progress. */
            progress?: {
                status: string;
                completed_at: null | string;
                video_last_position: number | null;
                video_total_watched: number | null;
            };
            /** @description Present for students with submissions for this block. */
            submissions?: components["schemas"]["SubmissionBrief"][];
            has_s3_video: boolean;
            completion_required: boolean;
            /** @description Present for staff readers. */
            s3_video_uploaded_at?: string | null;
            /** @description Present for staff readers. */
            s3_video_uploaded_by?: string | null;
        };
        Rubric: {
            id: number;
            title: string;
            description: null | string;
            criteria: components["schemas"]["RubricCriterion"][];
            /** @description Present in management responses; omitted from embedded learning responses. */
            curriculum_id?: number;
            /** @description Present in management responses; omitted from embedded learning responses. */
            active?: boolean;
        };
        RubricCriterion: {
            id: number;
            title: string;
            description: string;
            objective_code: null | string;
            rating: null | "exceeds" | "meets" | "developing" | "redo";
            feedback: null | string;
            /** @description Present in management responses; omitted from embedded learning responses. */
            position?: number;
            /** @description Present in management responses; omitted from embedded learning responses. */
            learning_objective_id?: null | number;
        };
        KnowledgeCheck: {
            id: number;
            prompt: string;
            options: string[];
            objective_code: null | string;
            /** @description Present for staff readers. */
            learning_objective_id?: null | number;
            attempt_count: number;
            latest_attempt: null | components["schemas"]["KnowledgeCheckAttempt"];
            /** @description Present for staff readers. */
            correct_option?: number;
            /** @description Present for staff readers. */
            explanation?: string;
        };
        KnowledgeCheckAttempt: {
            id: number;
            selected_option: number;
            correct: boolean;
            correct_option: number;
            explanation: string;
            created_at: string;
        };
        SubmissionBrief: {
            id: number;
            submission_type: null | string;
            text: null | string;
            grade: null | string;
            feedback: null | string;
            graded_at: null | string;
            repo_url: null | string;
            pr_url: null | string;
            live_url: null | string;
            branch: null | string;
            commit_sha: null | string;
            notes: null | string;
            num_submissions: number;
            created_at: string;
            updated_at: string;
            github_issue_url: string | null;
            github_code_url: string | null;
        };
        LessonResponse: {
            lesson: components["schemas"]["LessonDetail"];
        };
        Submission: {
            cohort_id: null | number;
            enrollment_id: null | number;
            id: number;
            latest_submission_id: null | number;
            content_block_id: number;
            user_id: number;
            user_name: string;
            submission_type: null | string;
            text: null | string;
            grade: null | string;
            feedback: null | string;
            graded_by: null | string;
            graded_at: null | string;
            github_issue_url: null | string;
            github_code_url: null | string;
            repo_url: null | string;
            pr_url: null | string;
            live_url: null | string;
            branch: null | string;
            commit_sha: null | string;
            notes: null | string;
            num_submissions: number;
            created_at: string;
            updated_at: string;
            content_block_title: string;
            content_block_type: string;
            lesson_id: number;
            lesson_title: string;
            module_id: number;
            module_name: string;
            filename: null | string;
            submission_config: {
                [key: string]: unknown;
            };
            language_hint: null | string;
            /** @description Present for staff in submission detail responses. */
            solution?: string | null;
            /** @description Present for staff in submission detail responses. */
            exercise_body?: string | null;
            /** @description Present for staff in submission detail responses. */
            exercise_video_url?: string | null;
            rubric: null | components["schemas"]["Rubric"];
            /** @description Present in detail, create, update and grade responses; omitted in lists. */
            github_checks?: components["schemas"]["GithubChecks"];
            cohort_name: string | null;
        };
        GithubChecks: {
            head_sha: null | string;
            fetched_at: null | string;
            summary: {
                total: number;
                passed: number;
                failed: number;
                pending: number;
                neutral: number;
            };
            runs: components["schemas"]["GithubCheckRun"][];
        };
        GithubCheckRun: {
            id: number;
            external_id: number;
            name: string;
            workflow_name: null | string;
            app_slug: null | string;
            head_sha: string;
            status: string;
            conclusion: null | string;
            details_url: null | string;
            started_at: null | string;
            completed_at: null | string;
            fetched_at: string;
        };
        SubmissionResponse: {
            submission: components["schemas"]["Submission"];
        };
        SubmissionsListResponse: {
            submissions: components["schemas"]["Submission"][];
        };
        ProgressEntry: {
            id: number;
            content_block_id: number;
            status: string;
            completed_at: null | string;
        };
        ProgressListResponse: {
            progress: components["schemas"]["ProgressEntry"][];
        };
        ProgressUpdateResponse: {
            progress: components["schemas"]["ProgressEntry"];
        };
        RecordingEntry: {
            id: string;
            cohort_id: number;
            title: string;
            url: string;
            date: null | string;
            recorded_date: null | string;
            description: null | string;
            /** @enum {string} */
            source: "youtube" | "vimeo" | "loom" | "direct" | "external";
            destination: components["schemas"]["RecordDestination"] | null;
            destination_path: string;
            cohort_name: string;
            /** @description Present only when supplied by a library item. */
            legacy_item_key?: null | string;
        };
        RecordingItem: {
            /** @description Present for library items; omitted for legacy external links. */
            legacy_item_key?: null | string;
            item_key: string;
            id: string | number;
            cohort_id: number;
            title: string;
            description: null | string;
            /** @enum {string} */
            source: "youtube" | "vimeo" | "loom" | "direct" | "external" | "uploaded";
            /**
             * @description Present for library items; omitted for legacy external links.
             * @enum {string}
             */
            status?: "draft" | "published";
            url: string | null;
            /** @description Present for legacy external links. */
            date?: null | string;
            recorded_date: null | string;
            /** @description Present for library items; omitted for legacy external links. */
            created_at?: string;
            /** @description Present for library items; omitted for legacy external links. */
            duration_seconds?: null | number;
            /** @description Present for library items; omitted for legacy external links. */
            duration_display?: null | string;
            /** @description Present for library items; omitted for legacy external links. */
            file_size_display?: string | null;
            /** @description Present for library items; omitted for legacy external links. */
            watch_progress?: null | components["schemas"]["S3RecordingWatchProgress"];
            destination: components["schemas"]["RecordDestination"] | null;
            destination_path: string;
            cohort_name: string;
        };
        S3RecordingWatchProgress: {
            last_position_seconds: number;
            total_watched_seconds: number;
            progress_percentage: number;
            completed: boolean;
            last_watched_at: null | string;
            /** @description Present in progress lists; omitted in nested recording progress. */
            recording_id?: number;
        };
        S3Recording: {
            id: number;
            cohort_id: number;
            title: string;
            description: null | string;
            /** @enum {string} */
            source: "youtube" | "vimeo" | "loom" | "direct" | "external" | "uploaded";
            url: null | string;
            content_type: null | string;
            file_size: null | number;
            file_size_display: null | string;
            duration_seconds: null | number;
            duration_display: null | string;
            /** @enum {string} */
            status: "draft" | "published";
            position: number;
            recorded_date: null | string;
            created_at: string;
            /** @description Present for staff readers. */
            s3_key?: string | null;
            /** @description Present for staff readers. */
            uploaded_by?: null | string;
            /** @description Present for students with saved watch progress. */
            watch_progress?: null | components["schemas"]["S3RecordingWatchProgress"];
        };
        CohortRecordingsResponse: {
            recordings: components["schemas"]["S3Recording"][];
        };
        RecordingResponse: {
            recording: components["schemas"]["S3Recording"];
        };
        RecordingsResponse: {
            recordings: components["schemas"]["RecordingEntry"][];
            s3_recordings: components["schemas"]["StudentLibraryRecording"][];
            items: components["schemas"]["RecordingItem"][];
        };
        WatchProgressUpdate: {
            recording_id: number;
            last_position_seconds: number;
            total_watched_seconds: number;
            progress_percentage: number;
            completed: boolean;
            last_watched_at: null | string;
        };
        WatchProgressUpdateResponse: {
            watch_progress: components["schemas"]["WatchProgressUpdate"];
        };
        VideoProgressEntry: {
            content_block_id: number;
            last_position: number;
            total_watched: number;
            duration: null | number;
            status: string;
            completed: boolean;
        };
        VideoProgressResponse: {
            video_progress: components["schemas"]["VideoProgressEntry"];
        };
        VideoStreamResponse: {
            stream_url: string;
            video_progress: components["schemas"]["VideoStreamProgress"] | null;
            expires_at: string;
        };
        RecordDestination: {
            kind: string;
            id: string | number | null;
            context: {
                [key: string]: unknown;
            };
            anchor: {
                [key: string]: unknown;
            };
        };
        StudentLibraryRecording: {
            legacy_item_key: null | string;
            id: number;
            cohort_id: number;
            title: string;
            description: null | string;
            /** @enum {string} */
            source: "youtube" | "vimeo" | "loom" | "direct" | "external" | "uploaded";
            /** @enum {string} */
            status: "draft" | "published";
            url: string | null;
            recorded_date: null | string;
            created_at: string;
            duration_seconds: null | number;
            duration_display: null | string;
            file_size_display: string | null;
            watch_progress: null | components["schemas"]["S3RecordingWatchProgress"];
            destination: components["schemas"]["RecordDestination"] | null;
            destination_path: string;
            cohort_name: string;
        };
        VideoStreamProgress: {
            last_position: number | null;
            total_watched: number | null;
            status: string;
            duration: number | null;
        };
        VideoProgressInput: {
            last_position_seconds: number;
            total_watched_seconds: number;
            duration_seconds?: number;
            cohort_id?: number;
            watch_credit_version?: number;
        };
        WatchProgressInput: {
            last_position_seconds: number;
            total_watched_seconds: number;
            duration_seconds?: number;
            cohort_id?: number;
            watch_credit_version?: number;
            recording_id: number;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
