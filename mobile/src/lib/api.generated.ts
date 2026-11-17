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
    "/api/v1/workspaces": {
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
                /** @description WorkspacesResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["WorkspacesResponse"];
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
                /** @description WorkspaceResponse */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["WorkspaceResponse"];
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
    "/api/v1/channels": {
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
                /** @description ChannelsResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ChannelsResponse"];
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
                /** @description ChannelResponse */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ChannelResponse"];
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
    "/api/v1/direct_conversations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    cohort_id?: number;
                    student_id?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description DirectConversationsResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DirectConversationsResponse"];
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
                /** @description DirectConversationResponse */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DirectConversationResponse"];
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
    "/api/v1/direct_conversations/available_users": {
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
                /** @description AvailableDirectUsersResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AvailableDirectUsersResponse"];
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
    "/api/v1/messages/search": {
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
                /** @description MessageSearchResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MessageSearchResponse"];
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
    "/api/v1/profile": {
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
                /** @description ProfileResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ProfileResponse"];
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
                /** @description ProfileUpdateResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ProfileUpdateResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/community_policy": {
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
                /** @description CommunityPolicyResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommunityPolicyResponse"];
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
    "/api/v1/user_blocks": {
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
                /** @description BlockedUsersResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["BlockedUsersResponse"];
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
                /** @description BlockedUserResponse */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["BlockedUserResponse"];
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
    "/api/v1/content_reports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    /** @description open: pending and reviewing, oldest first. resolved: actioned and dismissed, most recently resolved first. Without it: the 200 most recent reports. */
                    view?: "open" | "resolved";
                    status?: "pending" | "reviewing" | "actioned" | "dismissed";
                    page?: number;
                    per_page?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description ContentReportsResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ContentReportsResponse"];
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
                /** @description ContentReportResponse */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ContentReportResponse"];
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
    "/api/v1/data_deletion_requests": {
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
                /** @description DataDeletionRequestsResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DataDeletionRequestsResponse"];
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
                /** @description DataDeletionRequestResponse */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DataDeletionRequestResponse"];
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
    "/api/v1/push_subscriptions/config": {
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
                /** @description PushConfigResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["PushConfigResponse"];
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
    "/api/v1/mobile_push_tokens/config": {
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
                /** @description MobilePushConfig */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MobilePushConfig"];
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
    "/api/v1/feature_settings": {
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
                /** @description FeatureSettingsData */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["FeatureSettingsData"];
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
                /** @description FeatureSettingsData */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["FeatureSettingsData"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/cohorts/{cohort_id}/feature_settings": {
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
                /** @description FeatureSettingsData */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["FeatureSettingsData"];
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
                    cohort_id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description FeatureSettingsData */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["FeatureSettingsData"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
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
                /** @description SessionResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SessionResponse"];
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
    "/api/v1/community_policy/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
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
                /** @description CommunityPolicyResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommunityPolicyResponse"];
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
    "/api/v1/cable_token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
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
                /** @description CableTokenResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CableTokenResponse"];
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
    "/api/v1/message_preferences": {
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
                /** @description MessagePreferenceResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MessagePreferenceResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/message_attachments/presign": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
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
                /** @description MessageAttachmentPresignResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MessageAttachmentPresignResponse"];
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
    "/api/v1/push_subscriptions/preferences": {
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
                /** @description MessageNotificationPreferenceResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MessageNotificationPreferenceResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/push_subscriptions/web_preferences": {
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
                /** @description WebPushNotificationPreferenceResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["WebPushNotificationPreferenceResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/mobile_push_tokens/preferences": {
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
                /** @description MobilePushConfig */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MobilePushConfig"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/mobile_push_tokens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
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
                /** @description MobilePushTokenResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MobilePushTokenResponse"];
                    };
                };
                /** @description MobilePushTokenResponse */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MobilePushTokenResponse"];
                    };
                };
            };
        };
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description No content */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/push_subscriptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
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
                /** @description No content */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description No content */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description No content */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/user_blocks/{blocked_user_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    blocked_user_id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description No content */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/content_reports/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
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
                /** @description ContentReportResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ContentReportResponse"];
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
                /** @description ContentReportResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ContentReportResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/data_deletion_requests/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
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
                /** @description DataDeletionRequestResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DataDeletionRequestResponse"];
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
                /** @description DataDeletionRequestResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DataDeletionRequestResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/workspaces/{id}": {
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
                /** @description WorkspaceResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["WorkspaceResponse"];
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
                /** @description WorkspaceResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["WorkspaceResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/channels/{id}": {
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
                /** @description ChannelResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ChannelShowResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete: {
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
                /** @description ChannelResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ChannelResponse"];
                    };
                };
            };
        };
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
                /** @description ChannelResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ChannelResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/direct_conversations/{id}": {
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
                /** @description DirectConversationResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DirectConversationShowResponse"];
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
    "/api/v1/workspaces/{id}/memberships": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
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
                /** @description WorkspaceResponse */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["WorkspaceResponse"];
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
    "/api/v1/workspaces/{id}/memberships/{user_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                    user_id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description WorkspaceResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["WorkspaceResponse"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/channels/{id}/read": {
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
                /** @description ChannelResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ChannelResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/direct_conversations/{id}/read": {
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
                /** @description DirectConversationResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DirectConversationResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/channels/{channel_id}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    channel_id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description MessageResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MessageResponse"];
                    };
                };
                /** @description MessageResponse */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MessageResponse"];
                    };
                };
                /** @description MessageResponse */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MessageResponse"];
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
    "/api/v1/direct_conversations/{direct_conversation_id}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    direct_conversation_id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description MessageResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MessageResponse"];
                    };
                };
                /** @description MessageResponse */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MessageResponse"];
                    };
                };
                /** @description MessageResponse */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MessageResponse"];
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
    "/api/v1/messages/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
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
                /** @description MessageResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MessageResponse"];
                    };
                };
                /** @description MessageResponse */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MessageResponse"];
                    };
                };
            };
        };
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
                /** @description MessageResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MessageResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/messages/{id}/pin": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
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
                /** @description MessageResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MessageResponse"];
                    };
                };
            };
        };
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
                /** @description MessageResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MessageResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/messages/{id}/reactions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
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
                /** @description MessageResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MessageResponse"];
                    };
                };
            };
        };
        delete: {
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
                /** @description MessageResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MessageResponse"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/messages/{id}/thread": {
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
                /** @description ThreadResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ThreadResponse"];
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
    "/api/v1/messages/{id}/destination": {
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
                /** @description MessageDestination */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MessageDestination"];
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
    "/api/v1/agent_posting_tokens": {
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
                /** @description AgentPostingTokensResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AgentPostingTokensResponse"];
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
                /** @description AgentPostingTokenCreatedResponse */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AgentPostingTokenCreatedResponse"];
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
    "/api/v1/agent_posting_tokens/{id}/revoke": {
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
                /** @description AgentPostingTokenResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AgentPostingTokenResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/lessons/{lesson_id}/block_editor": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read a lesson for the block editor (staff; saving needs lesson editing access) */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    lesson_id: number;
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
                        "application/json": components["schemas"]["LessonBlockEditorResponse"];
                    };
                };
            };
        };
        /**
         * Save every block of a lesson in one transaction (staff; saving needs lesson editing access)
         * @description Atomic: lesson settings, blocks in order, removals and objective alignments commit together. Block ids are kept on reorder. 409 with code stale_editor when base_updated_at is not the current version; 422 with code learner_data, confirm_watch_reset or blocks_mismatch when a save would lose learner work or doesn't list every block, or retry when it collided with learner writes and saved nothing.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    lesson_id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["LessonBlockEditorInput"];
                };
            };
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LessonBlockEditorResponse"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/curricula": {
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
                /** @description Existing Rails response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CurriculaListResponse"];
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
            requestBody: {
                content: {
                    "application/json": {
                        name: string;
                        description?: string;
                        /** @enum {string} */
                        status?: "draft" | "active" | "archived";
                        total_weeks?: number;
                    };
                };
            };
            responses: {
                /** @description Existing Rails response */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CurriculumResponseMutation"];
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
    "/api/v1/curricula/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
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
                /** @description Existing Rails response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CurriculumResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete: {
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
                /** @description No content */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
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
                    "application/json": {
                        name?: string;
                        description?: string;
                        /** @enum {string} */
                        status?: "draft" | "active" | "archived";
                        total_weeks?: number;
                        base_updated_at: string;
                    };
                };
            };
            responses: {
                /** @description Existing Rails response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CurriculumResponseMutation"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/curricula/{curriculum_id}/modules": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                curriculum_id: number;
            };
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    curriculum_id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Existing Rails response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ModulesResponse"];
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
                    curriculum_id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name: string;
                        description?: string;
                        module_type?: string;
                        position: number;
                        total_days?: number;
                        day_offset?: number;
                        schedule_days?: string;
                    };
                };
            };
            responses: {
                /** @description Existing Rails response */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ModuleResponseMutation"];
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
    "/api/v1/modules/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
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
                /** @description Existing Rails response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ModuleResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete: {
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
                /** @description No content */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
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
                    "application/json": {
                        base_updated_at: string;
                        name?: string;
                        description?: string;
                        module_type?: string;
                        position?: number;
                        total_days?: number;
                        day_offset?: number;
                        schedule_days?: string;
                    };
                };
            };
            responses: {
                /** @description Existing Rails response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ModuleResponseMutation"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/users": {
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
                /** @description Existing Rails response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UsersListResponse"];
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
                /** @description Existing Rails response */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UserUpdateResponse"];
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
    "/api/v1/users/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
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
                /** @description Existing Rails response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UserDetailResponse"];
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
                /** @description Existing Rails response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UserUpdateResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/weekly_plan": {
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
                /** @description Existing Rails response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["WeeklyPlanResponse"];
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
    "/api/v1/dashboard": {
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
                /** @description Existing student or staff dashboard */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DashboardResponse"];
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
    "/api/v1/curricula/{curriculum_id}/modules/reorder": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                curriculum_id: number;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    curriculum_id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        module_ids: number[];
                    };
                };
            };
            responses: {
                /** @description Successful response */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cohorts/{cohort_id}/instructor_assignments": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                cohort_id: number;
            };
            cookie?: never;
        };
        /** Instructors assigned to a cohort, with their lesson editing access (admins) */
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
                        "application/json": components["schemas"]["CohortInstructorAssignmentsResponse"];
                    };
                };
            };
        };
        put?: never;
        /** Assign an instructor to a cohort (admins) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    cohort_id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        user_id: number;
                    };
                };
            };
            responses: {
                /** @description Successful response */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CohortInstructorAssignmentResponse"];
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
    "/api/v1/cohorts/{cohort_id}/instructor_assignments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                cohort_id: number;
                /** @description The instructor's user id */
                id: number;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove an instructor from a cohort, with any lesson editing access there (admins) */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    cohort_id: number;
                    /** @description The instructor's user id */
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description No content */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cohorts/{cohort_id}/instructor_assignments/{id}/lesson_editing": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                cohort_id: number;
                /** @description The instructor's user id */
                id: number;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Give or remove an instructor's lesson editing access for this cohort (admins)
         * @description Records lesson_editing_granted or lesson_editing_revoked in activity events. Setting the current value again changes nothing.
         */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    cohort_id: number;
                    /** @description The instructor's user id */
                    id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        can_edit_lessons: boolean;
                    };
                };
            };
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CohortInstructorAssignmentResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/lessons/{id}/move": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Move a lesson to a day and place in any module of its curriculum (admins)
         * @description The lesson keeps its id, so learner data stays attached. dry_run returns the impact only. expected_impact is the impact the person confirmed from a dry run: the move recomputes it under its locks and is refused with code impact_changed (and the new impact) when it differs. 409 stale_editor when base_updated_at isn't current; 422 with code module_mismatch, release_day, archived, learner_access (learners with work couldn't open the lesson at its new place today, by the lesson page's access rule), impact_changed, or retry.
         */
        post: {
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
                    "application/json": {
                        module_id: number;
                        release_day: number;
                        position: number;
                        base_updated_at: string;
                        dry_run?: boolean;
                        /** @description The impact the person confirmed from a dry run of these same parameters. */
                        expected_impact?: {
                            learners_losing_access: number;
                            learners_gaining_access: number;
                            self_paced_learners: boolean;
                        };
                    };
                };
            };
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LessonMoveResult"];
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
    "/api/v1/lessons/{id}/duplicate": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Copy a lesson and its blocks as new rows, archived, after the original (admins)
         * @description No learner data is copied; the copy's blocks are new rows.
         */
        post: {
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
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LessonResponse"];
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
    "/api/v1/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Search records the current viewer can open; no global counts */
        get: operations["searchEverything"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cohorts/accessible": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List slim summaries of cohorts accessible to the signed-in user */
        get: operations["getAccessibleCohorts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cohorts/{id}/setup_readiness": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
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
                        "application/json": components["schemas"]["SetupReadinessResponse"];
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
    "/api/v1/cohorts/{cohort_id}/enrollments/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                cohort_id: number;
            };
            cookie?: never;
        };
        get?: never;
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
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["BulkEnrollmentResponse"];
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
    "/api/v1/course_offerings": {
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
                        "application/json": components["schemas"]["PublicOfferingsResponse"];
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
    "/api/v1/safety/user_blocks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    page?: number;
                    per_page?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description SafetyUserBlocksResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SafetyUserBlocksResponse"];
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
    "/api/v1/team_members/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
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
                /** @description TeamMemberResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TeamMemberResponse"];
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
    "/api/v1/announcements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The updates feed. Readers get posted updates for their cohorts and the school; `scope=manage` gives staff the updates they can manage, with drafts only for their author and admins. */
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
                        "application/json": components["schemas"]["AnnouncementsResponse"];
                    };
                };
            };
        };
        put?: never;
        /** @description Posts an update (`status` `published`, the default) or saves a draft (`draft`). Posting notifies the audience; a draft notifies nobody. */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["AnnouncementCreateRequest"];
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AnnouncementResponse"];
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
    "/api/v1/announcements/{id}": {
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
                        "application/json": components["schemas"]["AnnouncementResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        /** @description Deletes a draft (the response is its last state) or archives a posted update. */
        delete: {
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
                        "application/json": components["schemas"]["AnnouncementResponse"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        /** @description The author or an admin edits a draft, posts it (`status` `published`, notifying the audience once), or edits a posted update's title and body without notifying anyone again. A posted update's audience can't change. */
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
                        "application/json": components["schemas"]["AnnouncementResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/cohorts/{cohort_id}/curriculum_copy": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                cohort_id: number;
            };
            cookie?: never;
        };
        /**
         * Preview Make a copy for this cohort (admins, and instructors with editing access for the cohort)
         * @description Dry run: the counts the copy would create and move, the other cohorts that keep the shared curriculum, and blockers (can_copy is false while any remain). 403 with code not_allowed for staff who can't copy for this cohort.
         */
        get: {
            parameters: {
                query: {
                    /** @description The curriculum the cohort uses now, as the editor saw it. */
                    source_curriculum_id: number;
                };
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
                        "application/json": components["schemas"]["CurriculumCopyPreviewResponse"];
                    };
                };
            };
        };
        put?: never;
        /**
         * Make a copy for this cohort
         * @description Copies the shared curriculum, switches the cohort to the copy and moves the cohort's learner data (progress, submissions, release dates and every other content reference) to the copy's ids in one transaction. Learner progress and the cohort's submission windows are compared before and after; any difference rolls back (422 verification_failed). Old ids keep resolving for the cohort's learners. 201 when copied; 200 with already_copied when an earlier request made it, so a client that timed out can repeat the request and gets the same copy. 409 busy when the copy waited more than 5 s on someone else's lock or a statement ran past 30 s (nothing was copied; repeat the request); 409 content_moved when the cohort no longer uses source_curriculum_id (reload). 403 not_allowed; 422 with code copy_not_needed, source_missing, source_archived, copied_before, unassigned_learner_work, media_missing, media_changed, verification_failed or invalid.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    cohort_id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        source_curriculum_id: number;
                    };
                };
            };
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CurriculumCopyResponse"];
                    };
                };
                /** @description Successful response */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CurriculumCopyResponse"];
                    };
                };
                /** @description Nothing was copied: busy (repeat the request in a moment) or content_moved (the cohort no longer uses this curriculum; reload). */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CurriculumCopyConflict"];
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
    "/api/v1/grading_queue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * One page of the Grading workbench's queue (staff)
         * @description Attempts in the viewer's scope (the cohort named, or every cohort they teach; every cohort for an admin), filtered and counted on the server. Rows carry no answer text. Old module and lesson ids from before a cohort's copy resolve to the copy's when cohort_id is given.
         */
        get: {
            parameters: {
                query?: {
                    cohort_id?: number;
                    /** @description ungraded (default): latest attempts with no grade. redo: latest attempts sent back. all: every attempt. */
                    filter?: "ungraded" | "redo" | "all";
                    module_id?: number;
                    student_id?: number;
                    lesson_id?: number;
                    /** @description oldest (default) or newest first; ids break ties. */
                    sort?: "oldest" | "newest";
                    /** @description 1-based; past the end serves the last page. */
                    page?: number;
                    /** @description Default 50, at most 100. */
                    per_page?: number;
                    /** @description Serve the page that holds this submission, when it is in the list. */
                    focus_id?: number;
                };
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
                        "application/json": components["schemas"]["GradingQueueResponse"];
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
    "/api/v1/progress/student/{user_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    cohort_id?: number;
                };
                header?: never;
                path: {
                    user_id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful staff response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["StudentWorkspaceProgressResponse"];
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
    "/api/v1/progress/student/{user_id}/communication": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query: {
                    cohort_id: number;
                };
                header?: never;
                path: {
                    user_id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Successful staff response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["StudentCommunicationResponse"];
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
    "/api/v1/cohorts/{id}": {
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
                /** @description Successful staff response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CohortWorkspaceResponse"];
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
    "/api/v1/cohorts/{cohort_id}/learning_insights": {
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
                /** @description Learning evidence with link context */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LearningInsightContextResponse"];
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
    "/api/v1/enrollments/{enrollment_id}/learning_plan": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                enrollment_id: number;
            };
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    enrollment_id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description LearningPlanManagement */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LearningPlanManagement"];
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    enrollment_id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["LearningPlanUpdateRequest"];
                };
            };
            responses: {
                /** @description LearningPlanManagement */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LearningPlanManagement"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/staff/private_meetings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    cohort_id?: number;
                    student_id?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description StaffPrivateMeetingsResponse */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["StaffPrivateMeetingsResponse"];
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
    "/api/v1/help_requests/{help_request_id}/replies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reply to a help request (staff)
         * @description Body: `{ "reply": { "body": string, "resolve": boolean, "client_request_id"?: string } }`. Without `resolve` the request stays active (an open request becomes acknowledged by the replier); with it the request is resolved. The learner is notified once, after the reply commits. `client_request_id` (8–64 letters, digits, `-` or `_`; one per reply attempt, reused on retry) makes a retry safe: if this author already saved a reply with that id on this request, that reply is returned with `replayed: true` and nobody is notified again, even when the first attempt resolved the request. 403 for learners, 404 outside the staff member's cohorts, 422 for a blank or too-long reply, a malformed client request id, or a new reply on a resolved or canceled request.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    help_request_id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Reply saved */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["HelpRequestReplyResponse"];
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
    "/api/v1/support_queue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    cohort_id?: number;
                    student_id?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Scoped staff support queue */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
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
    "/api/v1/course_offerings/{slug}": {
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
                    slug: string;
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
                        "application/json": components["schemas"]["PublicCourseResponse"];
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
    "/api/v1/dashboard/start_here": {
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
                    "application/json": {
                        cohort_id: number;
                    };
                };
            };
            responses: {
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["StartHereDismissalResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/records/{type}/{id}/usage": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                type: "curriculum" | "module" | "lesson";
                id: number;
            };
            cookie?: never;
        };
        /**
         * Where a curriculum, module or lesson is used (staff only; instructors see only the cohorts they teach)
         * @description Cohorts with delivery, release dates and schedules, submission and help counts, copy history, and rubric/objective lesson lists. Students and unknown records get 404. Cache-Control: private, no-store.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    type: "curriculum" | "module" | "lesson";
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
                        "application/json": components["schemas"]["RecordUsageResponse"];
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
    "/api/v1/records/{type}/{id}/detail": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                type: "recording" | "office_hour" | "private_meeting" | "learning_plan" | "channel" | "rubric" | "activity_event";
                id: number;
            };
            cookie?: never;
        };
        /**
         * A staff record page for a recording, office-hour session, private-meeting booking, learning plan, channel, rubric or activity event
         * @description Staff only. Instructors open records in cohorts they teach, and a booking only when they host it; a rubric names only their cohorts and counts the rest. Students, other cohorts' staff and unknown records get 404. Cache-Control: private, no-store.
         */
        get: {
            parameters: {
                query?: {
                    /** @description Continue a recording's watchers after this cursor (the previous response's watchers_next_after). Other values start from the beginning. */
                    watchers_after?: number;
                };
                header?: never;
                path: {
                    type: "recording" | "office_hour" | "private_meeting" | "learning_plan" | "channel" | "rubric" | "activity_event";
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
                        "application/json": components["schemas"]["RecordDetailResponse"];
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
    "/api/v1/course_outline": {
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
                /** @description The learner's course outline, or one enrolled learner's for staff (student_id) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CourseOutlineResponse"];
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
    "/api/v1/my_work": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    /** @description The cohort to read; the learner's first readable enrollment otherwise. */
                    cohort_id?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The learner's own submitted work in one cohort */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MyWorkResponse"];
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
            /** @description Staff replies, oldest first. Requests resolved before replies existed have none; their one response is `staff_response`, which always mirrors the latest reply. */
            replies: components["schemas"]["HelpRequestReply"][];
            /** @description Staff readers of one request (show, update, reply) only; null when no plan was started from it or the cohort has follow-up plans switched off. Never sent to learners or in lists. */
            follow_up?: components["schemas"]["HelpRequestFollowUp"] | null;
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
            /** @description Present for students with an enrollment. Where this lesson stands for the learner, from the server's one definition (LearnerProgress). Older servers omit it; clients then derive it with learnerLessonStatus. */
            learner_status?: components["schemas"]["LearnerLessonStatus"];
            /** @description Present for students with an enrollment. The lesson's handed-in steps (done or waiting for review), the count Today and Learn show for it. */
            completed_blocks?: number | null;
            /** @description Present for students with an enrollment. The lesson's steps that count toward completion. */
            total_blocks?: number | null;
            /** @description Present for students with an enrollment. The enrollment's single next step: the same lesson as the dashboard's continue_lesson and the plans' next_lesson. prev_lesson and next_lesson stay outline navigation. */
            next_step?: null | components["schemas"]["LearnerNextStep"];
            /** @description Present for students with an enrollment. */
            requires_github?: boolean;
            /** @description Present for students with an enrollment. */
            repository_name?: string | null;
            /** @description Present only when GET /api/v1/lessons/{id} named an id from before Make a copy for this cohort and returned the cohort's copy instead. Clients can replace the old id in their URL. */
            moved_from?: {
                /** @description The id the request named: the shared curriculum's lesson before this cohort's copy. */
                lesson_id: number;
                /** @description Old block id (string key) => this lesson's block id, for #block- links saved before the copy. */
                block_ids: {
                    [key: string]: number;
                };
            };
            learning_navigation?: components["schemas"]["LessonNavigation"];
            outline?: components["schemas"]["CourseOutline"];
            instructor?: {
                id: number;
                full_name: string;
                /** @enum {string} */
                role: "admin" | "instructor";
                avatar_url: string | null;
            } | null;
        };
        /**
         * @description Learner status vocabulary shared with web and mobile (fixtures/shared-logic-parity.json, statuses). awaiting_review: every step handed in, some waiting for review. redo: a step has Redo requested.
         * @enum {string}
         */
        LearnerLessonStatus: "done" | "awaiting_review" | "redo" | "in_progress" | "open" | "upcoming" | "closed";
        LearnerNextStep: {
            id: number;
            title: string;
            module_id: number;
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
            /** @description Included for staff module show. */
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
            /**
             * @description Lesson block evidence from LearnerProgress for the new student experience.
             * @enum {string}
             */
            learner_state?: "not_started" | "in_progress" | "submitted" | "redo_requested" | "complete";
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
            module_position: number | null;
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
            /** @enum {string|null} */
            course_delivery: "program" | "guided" | "self_paced" | null;
            week_number: number | null;
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
        CommunityPolicy: {
            version: string;
            accepted: boolean;
            accepted_at: string | null;
            privacy_url: string;
            terms_url: string;
            deletion_url: string;
        };
        WorkspaceSummary: {
            id: number;
            name: string;
            slug: string;
            workspace_type: "cohort" | "community";
            status: "active" | "archived";
            cohort_id: number | null;
            cohort_name: string | null;
            description: string | null;
            member_count: number;
            can_manage: boolean;
            created_at: string;
            updated_at: string;
        };
        WorkspaceMember: {
            id: number;
            full_name: string;
            /** @description Present in the relevant role or response context. */
            email?: string;
            role: string;
            avatar_url: string | null;
            handle: string | null;
            membership_role: string;
        };
        WorkspaceDetail: {
            id: number;
            name: string;
            slug: string;
            workspace_type: "cohort" | "community";
            status: "active" | "archived";
            cohort_id: number | null;
            cohort_name: string | null;
            description: string | null;
            member_count: number;
            can_manage: boolean;
            created_at: string;
            updated_at: string;
            members: components["schemas"]["WorkspaceMember"][];
        };
        ChannelSummary: {
            id: number;
            workspace_id: number;
            workspace_name: string;
            workspace_type: "cohort" | "community";
            cohort_id: number | null;
            cohort_name: string | null;
            name: string;
            description: string | null;
            visibility: "cohort" | "staff_only";
            status: "active" | "archived";
            position: number;
            muted: boolean;
            unread_count: number;
            last_read_at: string | null;
            last_read_message_id: number | null;
            latest_message: {
                id: number;
                body: string;
                created_at: string;
                author_name: string;
            } | null;
            created_at: string;
            updated_at: string;
        };
        MessageAttachment: {
            id: number;
            filename: string;
            content_type: string;
            byte_size: number;
            image: boolean;
            /** @description Included when stream URLs are requested and object storage is configured. */
            url?: string;
        };
        MessageReaction: {
            emoji: string;
            count: number;
            reacted: boolean;
            users: {
                id: number;
                full_name: string;
                avatar_url: string | null;
            }[];
        };
        ContentReport: {
            id: number;
            reason: "harassment" | "spam" | "inappropriate_content" | "safety_concern" | "other";
            details: string | null;
            status: "pending" | "reviewing" | "actioned" | "dismissed";
            created_at: string;
            resolved_at: string | null;
            reporter: {
                id: number;
                full_name: string;
                email: string;
                role: string;
            };
            reported_user: {
                id: number;
                full_name: string;
                email: string;
                role: string;
            };
            message: {
                id: number;
                body: string;
                channel_id: number | null;
                direct_conversation_id: number | null;
                created_at: string;
                conversation: components["schemas"]["ContentReportConversation"];
            } | null;
            reviewed_by: {
                id: number;
                full_name: string;
                email: string;
                role: string;
            } | null;
        };
        DataDeletionRequest: {
            id: number;
            status: "pending" | "processing" | "completed" | "declined";
            retention_note: string | null;
            created_at: string;
            resolved_at: string | null;
            user: {
                id: number;
                full_name: string;
                email: string;
            };
            resolved_by: {
                id: number;
                full_name: string;
            } | null;
        };
        BlockedUser: {
            id: number;
            full_name: string;
            avatar_url: string | null;
            blocked_at: string;
        };
        MessageSourceType: "lesson" | "submission" | "help_request" | "intervention";
        MessageSourceSummary: {
            type: components["schemas"]["MessageSourceType"];
            id: number | null;
            title: string;
            lesson_id: number | null;
            cohort_id: number | null;
            learner_path: string | null;
        };
        ChannelMessage: {
            id: number;
            channel_id: number | null;
            direct_conversation_id: number | null;
            parent_message_id: number | null;
            body: string;
            mention_user_ids: number[];
            edited_at: string | null;
            deleted_at: string | null;
            pinned_at: string | null;
            pinned_by_id: number | null;
            created_at: string;
            updated_at: string;
            mine: boolean;
            /** @description Present for the message author; nullable if no client id was supplied. */
            client_message_id?: string | null;
            blocked: boolean;
            attachments: components["schemas"]["MessageAttachment"][];
            reply_count: number;
            sent_via_label: string | null;
            reactions: components["schemas"]["MessageReaction"][];
            source: components["schemas"]["MessageSourceSummary"] | null;
            /** @description Included for the author when the response computes readers. */
            read_receipts?: {
                count: number;
                users: {
                    id: number;
                    full_name: string;
                    avatar_url: string | null;
                }[];
            };
            author: {
                id: number;
                full_name: string;
                role: string;
                avatar_url: string | null;
            };
        };
        UserSummary: {
            /** @description Included in directory context; omitted by conversation participant serializers. */
            cohort_name?: string | null;
            id: number;
            full_name: string;
            /** @description Included in authorized directory context; omitted by conversation participant serializers. */
            email?: string;
            role: string;
            avatar_url: string | null;
            /** @description Included by REST people lists; absent from realtime conversation summaries. */
            handle?: string | null;
            /** @description Included in directory context; omitted by conversation participant serializers. */
            archived_at?: string | null;
            is_admin: boolean;
            is_staff: boolean;
        };
        DirectConversationSummary: {
            id: number;
            workspace_id: number;
            workspace_name: string;
            workspace_type: "cohort" | "community";
            cohort_id: number | null;
            cohort_name: string | null;
            title: string;
            status: "active" | "archived";
            muted: boolean;
            unread_count: number;
            last_read_at: string | null;
            last_read_message_id: number | null;
            latest_message: {
                id: number;
                body: string;
                created_at: string;
                author_name: string;
            } | null;
            users: components["schemas"]["UserSummary"][];
            created_at: string;
            updated_at: string;
        };
        ChannelsResponse: {
            channels: components["schemas"]["ChannelSummary"][];
        };
        MessageWindowMeta: {
            oldest_message_id: number | null;
            newest_message_id: number | null;
            has_older: boolean;
            has_newer: boolean;
        };
        ChannelResponse: {
            channel: components["schemas"]["ChannelSummary"];
            /** @description Included on show responses only. */
            messages?: components["schemas"]["ChannelMessage"][];
            /** @description Included on show responses only. */
            pinned_messages?: components["schemas"]["ChannelMessage"][];
            /** @description Included on show responses only. */
            meta?: components["schemas"]["MessageWindowMeta"];
        };
        MessageResponse: {
            message: components["schemas"]["ChannelMessage"];
            /** @description Present for accepted messages whose delivery is pending. */
            delivery_pending?: boolean;
        };
        DirectConversationsResponse: {
            direct_conversations: components["schemas"]["DirectConversationSummary"][];
        };
        DirectConversationResponse: {
            direct_conversation: components["schemas"]["DirectConversationSummary"];
            /** @description Included on show responses only. */
            messages?: components["schemas"]["ChannelMessage"][];
            /** @description Included on show responses only. */
            pinned_messages?: components["schemas"]["ChannelMessage"][];
            /** @description Included on show responses only. */
            meta?: components["schemas"]["MessageWindowMeta"];
        };
        WorkspacesResponse: {
            workspaces: components["schemas"]["WorkspaceSummary"][];
        };
        WorkspaceResponse: {
            workspace: components["schemas"]["WorkspaceDetail"];
        };
        AvailableDirectUsersResponse: {
            users: components["schemas"]["UserSummary"][];
        };
        MessageAttachmentPresignResponse: {
            upload_url: string;
            fields: {
                [key: string]: string;
            };
            s3_key: string;
            max_size: number;
        };
        MessagePreferenceResponse: {
            preference: {
                target_type: string;
                target_id: number;
                muted: boolean;
            };
        };
        MessageSearchResponse: {
            results: {
                id: number;
                channel_id: number | null;
                direct_conversation_id: number | null;
                parent_message_id: number | null;
                body: string;
                mention_user_ids: number[];
                edited_at: string | null;
                deleted_at: string | null;
                pinned_at: string | null;
                pinned_by_id: number | null;
                created_at: string;
                updated_at: string;
                mine: boolean;
                /** @description Present for the message author; nullable if no client id was supplied. */
                client_message_id?: string | null;
                blocked: boolean;
                attachments: components["schemas"]["MessageAttachment"][];
                reply_count: number;
                sent_via_label: string | null;
                reactions: components["schemas"]["MessageReaction"][];
                source: components["schemas"]["MessageSourceSummary"] | null;
                /** @description Included for the author when the response computes readers. */
                read_receipts?: {
                    count: number;
                    users: {
                        id: number;
                        full_name: string;
                        avatar_url: string | null;
                    }[];
                };
                author: {
                    id: number;
                    full_name: string;
                    role: string;
                    avatar_url: string | null;
                };
                context: {
                    type: "channel" | "direct_conversation";
                    id: number;
                    label: string;
                    cohort_id: number | null;
                    workspace_id: number;
                };
            }[];
        };
        PushConfigResponse: {
            configured: boolean;
            public_key: string | null;
            missing: string[];
            /** @description Omitted only when push configuration falls back after an internal lookup error. */
            notifications_enabled?: boolean;
            /** @description Omitted only when push configuration falls back after an internal lookup error. */
            web_push_notifications_enabled?: boolean;
            /** @description Omitted only when push configuration falls back after an internal lookup error. */
            active_subscription_count?: number;
        };
        MessageNotificationPreferenceResponse: {
            notifications_enabled: boolean;
            active_subscription_count: number;
        };
        WebPushNotificationPreferenceResponse: {
            web_push_notifications_enabled: boolean;
            active_subscription_count: number;
        };
        CableTokenResponse: {
            token: string;
            expires_in: number;
        };
        SessionEnrollment: {
            id: number;
            cohort: {
                id: number;
                name: string;
                cohort_type: string;
                start_date: string;
                status: string;
                course_delivery: "program" | "guided" | "self_paced";
                features: {
                    [key: string]: boolean;
                };
                review_response_time?: string;
            };
            status: string;
            enrolled_at: string | null;
            access_expires_at: string | null;
            first_opened_at: string | null;
            support_expires_at: string | null;
        };
        ProfileEnrollment: {
            id: number;
            cohort_id: number;
            cohort_name: string;
            curriculum_name: string;
            status: string;
            enrolled_at: string | null;
            /** @description Whether the learner can still open this cohort (false once withdrawn or expired). */
            can_open: boolean;
        };
        ThreadResponse: {
            root_message: components["schemas"]["ChannelMessage"];
            replies: components["schemas"]["ChannelMessage"][];
            meta: components["schemas"]["MessageWindowMeta"];
        };
        SessionUser: {
            id: number;
            full_name: string;
            email: string;
            role: string;
            avatar_url: string | null;
            handle: string | null;
            is_admin: boolean;
            is_staff: boolean;
            clerk_id: string;
            first_name: string | null;
            last_name: string | null;
            github_username: string | null;
            last_seen_at: string | null;
            community_policy: components["schemas"]["CommunityPolicy"];
        };
        ProfileUser: {
            id: number;
            full_name: string;
            email: string;
            avatar_url: string | null;
            handle: string | null;
            first_name: string | null;
            last_name: string | null;
            github_username: string | null;
        };
        ProfileShowUser: {
            id: number;
            full_name: string;
            email: string;
            avatar_url: string | null;
            handle: string | null;
            first_name: string | null;
            last_name: string | null;
            github_username: string | null;
            role: string;
        };
        ProfileResponse: {
            user: components["schemas"]["ProfileShowUser"];
            enrollments: components["schemas"]["ProfileEnrollment"][];
        };
        ProfileUpdateResponse: {
            user: components["schemas"]["ProfileUser"];
        };
        SchoolConfig: {
            public_catalog_mode: string;
            name: string;
            product_name: string;
            support_email: string;
            site_url: string;
            time_zone: string;
            time_zone_label: string;
            features: {
                [key: string]: boolean;
            };
        };
        SessionResponse: {
            school: components["schemas"]["SchoolConfig"];
            user: components["schemas"]["SessionUser"];
            enrollments: components["schemas"]["SessionEnrollment"][];
        };
        CommunityPolicyResponse: {
            community_policy: components["schemas"]["CommunityPolicy"];
        };
        MobilePushConfig: {
            notifications_enabled: boolean;
            active_device_count: number;
        };
        MobilePushTokenResponse: {
            mobile_push_token: {
                id: number;
                platform: string;
                device_id: string | null;
                app_version: string | null;
                last_seen_at: string;
            };
        };
        FeatureSettingsData: {
            features: {
                [key: string]: boolean;
            };
            defaults: {
                [key: string]: boolean;
            };
            overrides: {
                [key: string]: boolean;
            };
            cohort: {
                id: number;
                name: string;
            } | null;
            /** @enum {unknown} */
            public_catalog_mode: "automatic" | "always" | "hidden";
            review_response_time?: string;
            review_response_time_default?: string;
            review_response_time_override?: string | null;
        };
        ContentReportsResponse: {
            content_reports: components["schemas"]["ContentReport"][];
            meta: components["schemas"]["PaginationMeta"];
        };
        ContentReportResponse: {
            content_report: components["schemas"]["ContentReport"];
        };
        DataDeletionRequestsResponse: {
            data_deletion_requests: components["schemas"]["DataDeletionRequest"][];
        };
        DataDeletionRequestResponse: {
            data_deletion_request: components["schemas"]["DataDeletionRequest"];
        };
        BlockedUsersResponse: {
            blocked_users: components["schemas"]["BlockedUser"][];
        };
        BlockedUserResponse: {
            blocked_user: components["schemas"]["BlockedUser"];
        };
        ApiError: {
            error: string;
            /** @description Included for machine-readable access denial or feature failures. */
            code?: string;
            /** @description Included with code confirm_watch_reset: the blocks whose student watch progress the save would reset. */
            block_ids?: number[];
            /** @description Included for feature_disabled. */
            feature?: string;
            /** @description Included when community terms acceptance is required. */
            community_policy?: components["schemas"]["CommunityPolicy"];
            /** @description Included with code impact_changed: the impact the move would have now. */
            impact?: components["schemas"]["LessonMoveImpact"];
        };
        ApiValidationError: {
            errors: string[];
            /** @description Included by submission validation when field-level errors are available. */
            field_errors?: {
                [key: string]: string[];
            };
        };
        ApiRequestError: components["schemas"]["ApiError"] | components["schemas"]["ApiValidationError"];
        ApiRateLimitError: {
            error: string;
            retry_after: number;
        };
        /** @description Rails exception middleware returns {status:404,error:"Not Found"} in production. Detailed exception responses additionally include exception/traces. Without a JSON Accept header Rails may return an empty body; shared error validation applies only to JSON responses. */
        RailsNotFoundError: {
            /** @constant */
            status: 404;
            error: string;
            exception?: string;
            traces?: {
                [key: string]: Record<string, never>[];
            };
        };
        ApiNotFoundError: components["schemas"]["ApiRequestError"] | components["schemas"]["RailsNotFoundError"];
        ChannelShowResponse: {
            channel: components["schemas"]["ChannelSummary"];
            messages: components["schemas"]["ChannelMessage"][];
            pinned_messages: components["schemas"]["ChannelMessage"][];
            meta: components["schemas"]["MessageWindowMeta"];
        };
        DirectConversationShowResponse: {
            direct_conversation: components["schemas"]["DirectConversationSummary"];
            messages: components["schemas"]["ChannelMessage"][];
            pinned_messages: components["schemas"]["ChannelMessage"][];
            meta: components["schemas"]["MessageWindowMeta"];
        };
        /** @description Legacy voice-specific limit does not send retry_after or Retry-After. */
        VoiceRateLimitError: {
            /** @constant */
            error: "Too many voice requests. Wait a few minutes and try again.";
        };
        ApiTooManyRequestsError: components["schemas"]["ApiRateLimitError"] | components["schemas"]["VoiceRateLimitError"];
        MessageDestination: {
            message_id: number;
            thread_root_id: number;
            channel_id: number | null;
            direct_conversation_id: number | null;
            workspace_id: number;
        };
        AgentPostingToken: {
            id: number;
            name: string;
            /** @constant */
            scope: "messages:write";
            /** @enum {unknown} */
            status: "active" | "expired" | "revoked";
            token_hint: string;
            created_at: string;
            last_used_at: string | null;
            expires_at: string | null;
            revoked_at: string | null;
        };
        AgentPostingTokensResponse: {
            agent_posting_tokens: components["schemas"]["AgentPostingToken"][];
        };
        AgentPostingTokenResponse: {
            agent_posting_token: components["schemas"]["AgentPostingToken"];
        };
        AgentPostingTokenCreatedResponse: {
            agent_posting_token: components["schemas"]["AgentPostingToken"];
            token: string;
        };
        /** @description Learner work recorded against one block. Any non-zero count protects the block from deletion and type changes. */
        BlockLearnerActivity: {
            content_block_id: number;
            submissions: number;
            /** @description Progress rows past not started or holding watch time. */
            progress: number;
            /** @description Learners with watch time on this block. */
            watched: number;
            check_attempts: number;
        };
        LessonEditorContext: {
            curriculum: {
                id: number;
                name: string;
            };
            module: {
                id: number;
                name: string;
                /** @description Days this module's schedule allows, through one week past its last lesson. */
                release_days: {
                    release_day: number;
                    week: number;
                    /** @enum {string} */
                    day_name: "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";
                }[];
            };
            /** @description Cohorts on this lesson’s curriculum that the viewer can see (admins: all; instructors: the cohorts they teach). */
            used_in: {
                id: number;
                name: string;
                /** @enum {string} */
                status: "upcoming" | "active" | "completed" | "archived";
                /** Format: date */
                start_date: string | null;
            }[];
            /** @description Cohorts on the same curriculum the viewer doesn’t teach, as a number and never named. Always 0 for admins, who see every cohort. */
            other_cohorts_count: number;
            /** @description Attempts in the cohorts listed in used_in. */
            submissions_count: number;
            /** @description Latest attempts without a grade in the cohorts listed in used_in. */
            waiting_count: number;
            /** @description Open help on the lesson or its exercises in the cohorts listed in used_in. */
            open_help_count: number;
        };
        LessonBlockEditorResponse: {
            lesson: components["schemas"]["LessonDetail"];
            block_activity: components["schemas"]["BlockLearnerActivity"][];
            context: components["schemas"]["LessonEditorContext"];
            access: components["schemas"]["LessonEditAccess"];
        };
        /** @description One block, in the order students see it. Existing blocks send `id`; new ones send a `client_id` that alignments can reference. */
        LessonBlockInput: {
            id?: number;
            client_id?: string;
            /** @enum {string} */
            block_type: "video" | "text" | "exercise" | "code_challenge" | "checkpoint" | "recording";
            title?: string | null;
            /** @description Markdown (or legacy HTML, kept as stored). */
            body?: string | null;
            solution?: string | null;
            filename?: string | null;
            /** Format: uri */
            video_url?: string | null;
            /** @enum {string|null} */
            submission_type?: "manual_complete" | "text_submission" | "prework_github_sync" | "repo_url_submission" | "repo_and_live_url_submission" | null;
            submission_config?: {
                [key: string]: unknown;
            };
            /** @description New blocks only (duplicates). */
            metadata?: {
                [key: string]: unknown;
            };
            rubric_id?: number | null;
            s3_video_key?: string | null;
            s3_video_content_type?: string | null;
            s3_video_size?: number | null;
            video_segments?: {
                label?: string;
                start_seconds?: number;
                end_seconds?: number;
                required?: boolean;
            }[];
            knowledge_check?: null | {
                prompt: string;
                options: string[];
                correct_option: number;
                explanation: string;
                learning_objective_id?: number | null;
            };
        };
        LessonBlockEditorInput: {
            lesson: {
                /** @description The lesson's updated_at from the last read. A different value returns 409 stale_editor. */
                base_updated_at: string;
                title?: string;
                required?: boolean;
                /** @description Must fall on one of the module's scheduled days. */
                release_day?: number;
                blocks: components["schemas"]["LessonBlockInput"][];
                /** @description Every existing block must be in blocks or here. Blocks with learner work can't be removed. */
                removed_block_ids?: number[];
                /** @description Blocks whose hosted video is replaced although learners have watch time; their watch time resets. */
                confirm_watch_reset_block_ids?: number[];
                alignments?: {
                    learning_objective_id: number;
                    content_block_id?: number | null;
                    block_client_id?: string;
                }[];
            };
        };
        CurriculumSummary: {
            id: number;
            name: string;
            description: string | null;
            total_weeks: number | null;
            /** @enum {string} */
            status: "draft" | "active" | "archived";
            updated_at: string;
            modules_count: number;
            archive_blocked: boolean;
            live_checkout_offerings: {
                id: number;
                name: string;
            }[];
            active_self_paced_learners: boolean;
            /** @description Number of cohorts using this curriculum across all staff scopes; no cohort identities are exposed. */
            cohorts_count?: number;
            /** @description Distinct delivery modes across all cohorts using this curriculum. */
            course_delivery_modes?: ("program" | "self_paced")[];
        };
        CurriculumDetail: {
            id: number;
            name: string;
            description: string | null;
            total_weeks: number | null;
            /** @enum {string} */
            status: "draft" | "active" | "archived";
            updated_at: string;
            modules_count: number;
            /** @description Included on curriculum show, omitted on create/update. */
            modules: components["schemas"]["CurriculumModuleDetail"][];
            archive_blocked: boolean;
            live_checkout_offerings: {
                id: number;
                name: string;
            }[];
            active_self_paced_learners: boolean;
            editing?: components["schemas"]["LessonEditAccess"];
        };
        LessonSummary: {
            id: number;
            title: string;
            lesson_type: string;
            position: number;
            release_day: number;
            required: boolean;
            requires_submission: boolean;
            submission_type: string;
            content_blocks_count: number;
            archived_at: string | null;
            updated_at: string;
        };
        ModuleSummary: {
            id: number;
            curriculum_id: number;
            name: string;
            module_type: string;
            description: string | null;
            position: number;
            total_days: number | null;
            day_offset: number;
            schedule_days: string;
            updated_at: string;
            scheduled_day_names: string[];
            week_count: number;
            lessons_count: number;
            /** @description Present in staff module responses. */
            archived_lessons_count?: number;
            /** @description Staff responses provide this field; student responses omit it. */
            submissions_count?: number;
            /** @description Staff responses provide this field; student responses omit it. */
            deletion_blocked?: boolean;
        };
        ModuleDetail: {
            id: number;
            curriculum_id: number;
            name: string;
            module_type: string;
            description: string | null;
            position: number;
            total_days: number | null;
            day_offset: number;
            schedule_days: string;
            updated_at: string;
            scheduled_day_names: string[];
            week_count: number;
            lessons_count: number;
            /** @description Present in staff module responses. */
            archived_lessons_count?: number;
            /** @description Included on module show, omitted on create/update. */
            lessons: {
                id: number;
                title: string;
                lesson_type: string;
                position: number;
                release_day: number;
                required: boolean;
                /** @description Present in student module show. */
                available?: boolean;
                /** @description Present in student module show. */
                unlock_date?: string | null;
                /** @description Present in student module show. */
                content_blocks_count?: number;
                /** @description Present in staff module show. */
                content_blocks?: components["schemas"]["ModuleEditorBlock"][];
                /** @description Present in staff module show. */
                archived_at?: string | null;
                /** @description Present in staff module show. */
                updated_at?: string;
                /** @description Present in staff module show. */
                requires_submission?: boolean;
                /** @description Present in staff module show. */
                submission_type?: string;
            }[];
            /** @description Staff responses provide this field; student responses omit it. */
            submissions_count?: number;
            /** @description Staff responses provide this field; student responses omit it. */
            deletion_blocked?: boolean;
        };
        CurriculaListResponse: {
            curricula: components["schemas"]["CurriculumSummary"][];
        };
        CurriculumResponse: {
            curriculum: components["schemas"]["CurriculumDetail"];
        };
        ModuleResponse: {
            module: components["schemas"]["ModuleDetail"];
        };
        AttentionAction: {
            label: string;
            web_path: string;
            native_path: string;
            web_handoff: boolean;
            enrollment_id: number;
        };
        AttentionReason: {
            code: string;
            label: string;
            source_type: string;
            source_ids: number[];
            since: string | null;
            action: components["schemas"]["AttentionAction"];
        };
        StaffAttention: {
            generated_at: string;
            students: components["schemas"]["SupportQueueStudent"][];
            summary: {
                student_count: number;
                checked_enrollment_count: number;
                ungraded_count: number;
                redo_count: number;
                reason_counts: {
                    [key: string]: number;
                };
            };
        };
        SupportQueueStudent: {
            needs_attention: boolean;
            reasons: components["schemas"]["AttentionReason"][];
            next_action: components["schemas"]["AttentionAction"] | null;
            /** @description The learner’s status in a few words: the top attention reason ("Needs help", "Going quiet", ...), "On track", or the enrollment state when not active. */
            status_label: string;
            released_blocks: number;
            released_unfinished_blocks: number;
            enrollment_id: number;
            user_id: number;
            cohort_id: number;
            full_name: string;
            email: string;
            cohort_name: string;
            progress_percentage: number;
            completed_blocks: number;
            total_blocks: number;
            /** @description Lessons with every step handed in (LearnerProgress); a lesson with no steps is not counted. */
            completed_lessons: number;
            /** @description Lessons counted toward progress: required ones under a personal plan, otherwise every assigned lesson with steps. */
            total_lessons: number;
            last_activity_at: string | null;
            help_request_count: number;
            urgent_help_count: number;
            redo_count: number;
            ungraded_count: number;
            inactive: boolean;
            active_intervention_id: number | null;
            intervention_status: components["schemas"]["InterventionStatus"] | null;
            follow_up_due: boolean;
            recovery_plan_id: number | null;
            recovery_check_in_due: boolean;
            priority: number;
            invited_at: string | null;
            joined_at: string | null;
            last_sign_in_at: string | null;
            last_seen_at: string | null;
            github_username: string | null;
            invite_state: string;
            invite_delivery_status: string;
            status: string;
            enrollment_status: string;
            assigned_module_count: number;
            blocks_this_week: number;
            submissions_this_week: number;
            next_review_submission_id?: number | null;
            active_intervention_count?: number;
        };
        InterventionStatus: "open" | "contacted" | "waiting_on_student" | "monitoring" | "resolved" | "canceled";
        OfficeHourOccurrence: {
            office_hour_id: number;
            title: string;
            description: string | null;
            starts_at: string;
            ends_at: string;
            meeting_url: string;
            timezone: string;
            recurrence: "once" | "weekly";
            event_kind: "office_hours" | "live_class";
        };
        PersonalPlanLesson: {
            lesson_id: number;
            module_id: number;
            title: string;
            required: boolean;
            available: boolean;
            completed: boolean;
            review_status: "awaiting_review" | "redo_requested" | "reviewed" | null;
            learner_status: components["schemas"]["LearnerLessonStatus"];
        };
        PersonalLearningPlan: {
            submission_deadlines: components["schemas"]["PersonalLearningPlanSubmissionDeadlinesItem"][];
            title: string;
            description: string | null;
            target_date: string | null;
            next_check_in_on: string | null;
            updated_at: string;
            required_count: number;
            completed_count: number;
            awaiting_review_count: number;
            milestones: components["schemas"]["PersonalLearningPlanMilestonesItem"][];
            next_lesson: components["schemas"]["PersonalPlanLesson"] | null;
            requirement_changes: components["schemas"]["PersonalLearningPlanRequirementChangesItem"][];
        };
        WeeklyPlanLessonItem: {
            id: string;
            /** @constant */
            kind: "lesson";
            lesson_id: number;
            module_id: number;
            title: string;
            module_title: string;
            lesson_type: string;
            required: boolean;
            scheduled_for: string;
            carried_forward: boolean;
            state: "completed" | "open" | "upcoming" | "closed";
            review_status: "awaiting_review" | "redo_requested" | "reviewed" | null;
            submission_close_at: string | null;
            submissions_closed: boolean;
            learner_status: components["schemas"]["LearnerLessonStatus"];
        };
        WeeklyPlan: {
            /** @description Included when the learner has an accessible enrollment; personal_plan can be null. */
            personal_plan?: components["schemas"]["PersonalLearningPlan"] | null;
            enrolled: boolean;
            /** @description Included for alumni or self-paced library plans. */
            mode?: "weekly" | "library";
            /**
             * @description Present for self-paced plans.
             * @constant
             */
            plan_kind?: "self_paced";
            /** @description Included when the learner has an accessible enrollment. */
            capabilities?: components["schemas"]["LearnerCapabilities"];
            /** @description Present for self-paced plans. */
            course_overview?: {
                course_name: string;
                next_lesson: {
                    lesson_id: number;
                    title: string;
                    module_id: number;
                    /** @description Included when projected from a personal learning plan. */
                    required?: boolean;
                    /** @description Included when projected from a personal learning plan. */
                    available?: boolean;
                    /** @description Included when projected from a personal learning plan. */
                    completed?: boolean;
                    /** @description Included when projected from a personal learning plan. */
                    review_status?: "awaiting_review" | "redo_requested" | "reviewed" | null;
                    /** @description Included when projected from a personal learning plan. */
                    learner_status?: components["schemas"]["LearnerLessonStatus"];
                } | null;
            };
            /** @description Included when the learner has an accessible enrollment. */
            cohort?: {
                id: number;
                name: string;
            };
            /** @description Present for scheduled weekly plans. */
            week_number?: number;
            /** @description Present for scheduled weekly plans. */
            starts_on?: string;
            /** @description Present for scheduled weekly plans. */
            ends_on?: string;
            timezone: string;
            /** @description Included when the learner has an accessible enrollment. */
            generated_at?: string;
            /** @description Present for scheduled weekly plans. */
            summary?: {
                required_count: number;
                required_completed_count: number;
                open_redo_count: number;
                optional_count: number;
            };
            /** @description Included for alumni or self-paced library plans. */
            library_summary?: {
                module_count: number;
                lesson_count: number;
                recording_count: number;
            };
            /** @description Present for scheduled weekly plans. */
            required?: components["schemas"]["WeeklyPlanLessonItem"][];
            /** @description Present for scheduled weekly plans. */
            optional?: components["schemas"]["WeeklyPlanLessonItem"][];
            /** @description Included for scheduled weekly and self-paced plans. */
            redos?: components["schemas"]["WeeklyPlanRedosItem"][];
            /** @description Included when the learner has an accessible enrollment. */
            events?: components["schemas"]["WeeklyPlanEventsItem"][];
            /** @description Present for scheduled weekly plans. */
            upcoming_unlocks?: components["schemas"]["WeeklyPlanUpcomingUnlocksItem"][];
            /** @description Included when the learner has an accessible enrollment. */
            recording_catch_up?: components["schemas"]["WeeklyPlanRecordingCatchUpItem"][];
        };
        WeeklyPlanResponse: {
            weekly_plan: components["schemas"]["WeeklyPlan"];
        };
        DashboardData: {
            /** @description Present for enrolled student dashboards. */
            enrollment_status?: string;
            /** @description Present for enrolled student dashboards. */
            paused_since?: string | null;
            /** @description Present for enrolled student dashboards. */
            support_instructor_id?: number | null;
            /** @description Present for enrolled student dashboards; personal_plan can be null. */
            personal_plan?: components["schemas"]["PersonalLearningPlan"] | null;
            /** @description Present for staff dashboards. */
            attention?: components["schemas"]["StaffAttention"];
            /** @description Present for students without an accessible enrollment. */
            catalog_enabled?: boolean;
            /** @description Present for students without an accessible enrollment. */
            pending_purchases?: components["schemas"]["DashboardDataPendingPurchasesItem"][];
            /** @description Present for enrolled student dashboards. */
            capabilities?: components["schemas"]["LearnerCapabilities"];
            /** @description Present for student dashboards. */
            enrolled?: boolean;
            /** @description Present for enrolled student dashboards. */
            private_meetings_enabled?: boolean;
            /** @description Present for enrolled student dashboards. */
            course_access?: {
                course_delivery: "program" | "guided" | "self_paced";
                access_expires_at: string | null;
                support_expires_at: string | null;
                support_weeks?: number;
            };
            user: components["schemas"]["DashboardUser"];
            cohort?: {
                id: number;
                name: string;
                /** @description Included for the applicable student or staff dashboard context. */
                cohort_type?: string;
                start_date: string;
                status: string;
                announcements?: components["schemas"]["DashboardAnnouncement"][];
                /** @description Included for the applicable student or staff dashboard context. */
                unread_notifications_count?: number;
                /** @description Included for the applicable student or staff dashboard context. */
                features?: {
                    [key: string]: boolean;
                };
                /** @description Included for the applicable student or staff dashboard context. */
                requires_github?: boolean;
                /** @description Included for the applicable student or staff dashboard context. */
                enrolled_count?: number;
                /** @description Included for the applicable student or staff dashboard context. */
                active_count?: number;
                /** @description Included for the applicable student or staff dashboard context. */
                students_without_modules_count?: number;
            };
            /** @description Present for enrolled student dashboards. */
            overall_progress?: {
                completed: number;
                total: number;
                percentage: number;
                /** @description Lessons with every step handed in (LearnerProgress); a lesson with no steps is not counted. */
                completed_lessons: number;
                /** @description Lessons counted toward progress: required ones under a personal plan, otherwise every assigned lesson with steps. */
                total_lessons: number;
            };
            /** @description Present for enrolled student dashboards. */
            modules?: components["schemas"]["StudentDashboardModule"][];
            /** @description Present for enrolled student dashboards. */
            continue_lesson?: {
                id: number;
                title: string;
            } | null;
            /** @description Present for enrolled student dashboards. */
            action_items?: components["schemas"]["DashboardDataActionItemsItem"][];
            /** @description Present for enrolled student dashboards. */
            resources?: components["schemas"]["DashboardDataResourcesItem"][];
            /** @description Present for enrolled student dashboards. */
            office_hours?: components["schemas"]["OfficeHourOccurrence"][];
            /** @description Staff dashboards only. */
            cohorts?: components["schemas"]["StaffCohortDashboard"][];
            /** @description Staff dashboard with a primary cohort. */
            students?: components["schemas"]["SupportQueueStudent"][];
            /** @description Staff dashboard with a primary cohort. */
            ungraded_count?: number;
            /** @description Enrolled student dashboards only. */
            recently_graded?: components["schemas"]["DashboardDataRecentlyGradedItem"][];
            /** @description Staff-only ranked action inbox. */
            today?: components["schemas"]["InstructorToday"];
            start_here?: boolean;
            review_response_time?: string;
            /** @description Present for enrolled student dashboards only when the cohort's student_experience_v2 switch is explicitly on. */
            student_today?: components["schemas"]["StudentToday"];
        };
        InviteState: "not_sent" | "queued" | "sent" | "failed" | "expired" | "accepted";
        UserEnrollment: {
            /** @description Included with users index enrollments. */
            cohort_status?: string;
            /** @description Included with users index enrollments. */
            access_expires_at?: string | null;
            id: number;
            cohort_id: number;
            cohort_name: string;
            status: string;
            enrolled_at: string | null;
            completed_at: string | null;
        };
        UserListItem: {
            last_sign_in_at: string | null;
            last_seen_at: string | null;
            archived_at: string | null;
            invite_pending: boolean;
            invite_delivery_status: "not_sent" | "queued" | "sent" | "failed" | "accepted";
            invite_state: components["schemas"]["InviteState"];
            invite_sent_at: string | null;
            invite_expires_at: string | null;
            invite_last_error: string | null;
            created_at: string;
            /** @description Included on users index only when include_enrollments is requested. */
            enrollments?: components["schemas"]["UserEnrollment"][];
            id: number;
            email: string;
            first_name: string | null;
            last_name: string | null;
            full_name: string;
            role: string;
            github_username: string | null;
            avatar_url: string | null;
            handle: string | null;
        };
        UsersListResponse: {
            users: components["schemas"]["UserListItem"][];
            /** @description Present when pagination is requested. */
            meta?: {
                page: number;
                per_page: number;
                total_count: number;
                total_pages: number;
                has_next_page: boolean;
                has_prev_page: boolean;
            };
        };
        UserDetailResponse: {
            user: components["schemas"]["UserListItem"];
            enrollments: components["schemas"]["UserEnrollment"][];
        };
        UserUpdateResponse: {
            user: components["schemas"]["UserListItem"];
        };
        ModulesResponse: {
            modules: components["schemas"]["ModuleSummary"][];
        };
        StudentDashboardLesson: {
            id: number;
            title: string;
            lesson_type: string;
            added_at: string;
            release_day: number;
            required: boolean;
            available: boolean;
            unlock_date: string | null;
            completed: boolean;
            review_status: "awaiting_review" | "redo_requested" | "reviewed" | null;
            total_blocks: number;
            completed_blocks: number;
            submission_window: components["schemas"]["SubmissionWindowStatus"];
            learner_status: components["schemas"]["LearnerLessonStatus"];
            kind: components["schemas"]["LessonKind"];
        };
        StudentDashboardModule: {
            id: number;
            name: string;
            module_type: string;
            position: number;
            progress_percentage: number;
            completed_blocks: number;
            total_blocks: number;
            /** @description Lessons with every step handed in (LearnerProgress); a lesson with no steps is not counted. */
            completed_lessons: number;
            /** @description Lessons counted toward progress: required ones under a personal plan, otherwise every assigned lesson with steps. */
            total_lessons: number;
            assigned: boolean;
            unlocked: boolean;
            available: boolean;
            unlock_date: string | null;
            lessons: components["schemas"]["StudentDashboardLesson"][];
        };
        DashboardAnnouncement: {
            unread: boolean;
            id: number;
            title: string;
            body: string;
            pinned: boolean;
            published_at: string | null;
            cohort_id: number | null;
            cohort_name: string | null;
            read_at: string | null;
            author: {
                id: number;
                full_name: string;
                email: string;
            };
        };
        StaffCohortDashboard: {
            cohort: components["schemas"]["StaffDashboardCohort"];
            students: components["schemas"]["SupportQueueStudent"][];
            ungraded_count: number;
        };
        DashboardResponse: {
            dashboard: components["schemas"]["DashboardData"];
        };
        CurriculumModuleDetail: {
            id: number;
            curriculum_id: number;
            name: string;
            module_type: string;
            description: string | null;
            position: number;
            total_days: number | null;
            day_offset: number;
            schedule_days: string;
            updated_at: string;
            scheduled_day_names: string[];
            week_count: number;
            lessons_count: number;
            archived_lessons_count: number;
            lessons: components["schemas"]["LessonSummary"][];
            submissions_count: number;
            deletion_blocked: boolean;
        };
        ModuleEditorBlock: {
            id: number;
            block_type: string;
            position: number;
            title: null | string;
            body: null | string;
            video_url: null | string;
            filename: null | string;
            submission_type: null | string;
            submission_type_explicit: null | string;
            submission_config: {
                [key: string]: unknown;
            };
            metadata: {
                [key: string]: unknown;
            };
            /** @description Included for staff module show. */
            solution?: null | string;
        };
        CurriculumDetailMutation: {
            id: number;
            name: string;
            description: string | null;
            total_weeks: number | null;
            /** @enum {string} */
            status: "draft" | "active" | "archived";
            updated_at: string;
            modules_count: number;
            archive_blocked: boolean;
            live_checkout_offerings: {
                id: number;
                name: string;
            }[];
            active_self_paced_learners: boolean;
        };
        CurriculumResponseMutation: {
            curriculum: components["schemas"]["CurriculumDetailMutation"];
        };
        ModuleDetailMutation: {
            id: number;
            curriculum_id: number;
            name: string;
            module_type: string;
            description: string | null;
            position: number;
            total_days: number | null;
            day_offset: number;
            schedule_days: string;
            updated_at: string;
            scheduled_day_names: string[];
            week_count: number;
            lessons_count: number;
            /** @description Present in staff module responses. */
            archived_lessons_count?: number;
            /** @description Staff responses provide this field; student responses omit it. */
            submissions_count?: number;
            /** @description Staff responses provide this field; student responses omit it. */
            deletion_blocked?: boolean;
        };
        ModuleResponseMutation: {
            module: components["schemas"]["ModuleDetailMutation"];
        };
        DashboardUser: {
            id: number;
            full_name: string;
            email: string;
            role: string;
            avatar_url: string | null;
            is_admin: boolean;
            is_staff: boolean;
        };
        StaffDashboardCohort: {
            id: number;
            name: string;
            start_date: string;
            status: string;
            features: {
                [key: string]: boolean;
            };
            enrolled_count: number;
            active_count: number;
            students_without_modules_count: number;
        };
        WeeklyPlanRedosItem: {
            id: string;
            /** @constant */
            kind: "redo";
            submission_id: number;
            content_block_id: number;
            lesson_id: number;
            title: string;
            lesson_title: string;
            feedback: string | null;
            state: "open" | "closed";
            submission_close_at: string | null;
        };
        WeeklyPlanEventsItem: {
            id: string;
            kind: "office_hours" | "live_class";
            office_hour_id: number;
            title: string;
            description: string | null;
            starts_at: string;
            ends_at: string;
            meeting_url: string;
            timezone: string;
            recurrence: "once" | "weekly";
            event_kind: "office_hours" | "live_class";
        };
        WeeklyPlanUpcomingUnlocksItem: {
            id: string;
            /** @constant */
            kind: "unlock";
            lesson_id: number;
            module_id: number;
            title: string;
            module_title: string;
            unlocks_on: string;
            required: boolean;
        };
        WeeklyPlanRecordingCatchUpItem: {
            id: string;
            /** @constant */
            kind: "recording";
            recording_id: number;
            cohort_id: number;
            title: string;
            recorded_on: string | null;
            progress_percentage: number;
        };
        DashboardDataPendingPurchasesItem: {
            id: number;
            cohort_id: number;
            course_name: string;
        };
        DashboardDataActionItemsItem: {
            type: string;
            submission_id: number;
            content_block_id: number;
            submission_type: string;
            cohort_id: number;
            lesson_id: number;
            lesson_title: string;
            content_block_title: string;
            feedback: string | null;
            submission_window: components["schemas"]["SubmissionWindowStatus"];
            submissions_closed: boolean;
        };
        DashboardDataResourcesItem: {
            id: number;
            title: string;
            url: string;
            category: string;
            description: string | null;
        };
        DashboardDataRecentlyGradedItem: {
            submission_id: number;
            content_block_id: number;
            cohort_id: number;
            lesson_id: number;
            lesson_title: string;
            content_block_title: string;
            grade: string;
            feedback: string | null;
            graded_at: string | null;
        };
        PersonalLearningPlanSubmissionDeadlinesItem: {
            lesson_id: number;
            title: string;
            available: boolean;
            closes_at: string | null;
            closed: boolean;
        };
        PersonalLearningPlanMilestonesItem: {
            title: string;
            due_on: string;
            required_count: number;
            completed_count: number;
            lessons: components["schemas"]["PersonalPlanLesson"][];
        };
        PersonalLearningPlanRequirementChangesItem: {
            lesson_id: number;
            title: string;
            required: boolean;
            reason: string;
        };
        LessonEditGrant: {
            cohort: {
                id: number;
                name: string;
            };
            granted_by: null | {
                id: number;
                full_name: string;
            };
            granted_at: string | null;
        };
        /** @description Whether the signed-in staff member may change this curriculum's lessons. Admins always can; an instructor can when an admin gave them editing access for every cohort that uses the curriculum (grants), otherwise reason is shared (shared_with names the other cohorts the viewer teaches; shared_with_others_count counts the rest) or no_grant. */
        LessonEditAccess: {
            can_edit: boolean;
            /** @enum {string} */
            reason: "admin" | "granted" | "shared" | "no_grant" | "not_staff";
            message: string | null;
            grants: components["schemas"]["LessonEditGrant"][];
            /** @description Sharing cohorts the viewer may see by name: every one for admins, the ones they teach for instructors. */
            shared_with: {
                id: number;
                name: string;
            }[];
            /** @description Other cohorts sharing the curriculum that the viewer doesn’t teach, as a number and never named. Always 0 for admins, who see every cohort. */
            shared_with_others_count: number;
            /** @description Cohorts this staff member can make their own copy for (Make a copy for this cohort): an instructor's granted cohorts when reason is shared; for an admin, every cohort on a curriculum that two or more cohorts use. Empty otherwise. */
            copy_cohorts: {
                id: number;
                name: string;
            }[];
            copy_of: null | components["schemas"]["CurriculumCopyOrigin"];
        };
        CohortInstructorAssignment: {
            /** @description The instructor's user id */
            id: number;
            full_name: string;
            email: string;
            can_edit_lessons: boolean;
            edit_granted_by: null | {
                id: number;
                full_name: string;
            };
            edit_granted_at: string | null;
        };
        CohortInstructorAssignmentsResponse: {
            instructors: components["schemas"]["CohortInstructorAssignment"][];
        };
        CohortInstructorAssignmentResponse: {
            instructor: components["schemas"]["CohortInstructorAssignment"];
        };
        /** @description Who would stop or start seeing the lesson because it changes module or day. A move is refused while learners_with_work_losing_access is above zero. */
        LessonMoveImpact: {
            learners_losing_access: number;
            learners_with_work_losing_access: number;
            learners_gaining_access: number;
            self_paced_learners: boolean;
        };
        LessonMovePreviewResponse: {
            impact: components["schemas"]["LessonMoveImpact"];
        };
        LessonMoveResponse: {
            lesson: components["schemas"]["LessonDetail"];
            impact: components["schemas"]["LessonMoveImpact"];
        };
        LessonMoveResult: components["schemas"]["LessonMoveResponse"] | components["schemas"]["LessonMovePreviewResponse"];
        SearchResponse: {
            groups: components["schemas"]["SearchResultGroup"][];
            /** @description True when a statement timeout stopped search; groups contain completed results. */
            partial?: boolean;
        };
        SearchResultItem: {
            id: string;
            title: string;
            snippet: string;
            destination: components["schemas"]["RecordDestination"];
        };
        SearchResultGroup: {
            type: string;
            results: components["schemas"]["SearchResultItem"][];
        };
        AccessibleCohortsResponse: {
            cohorts: components["schemas"]["AccessibleCohort"][];
        };
        AccessibleCohort: {
            id: number;
            name: string;
            curriculum_id: number;
            /** @enum {string} */
            course_delivery: "program" | "guided" | "self_paced";
            status?: string;
            cohort_type?: string;
            curriculum_name?: string;
        };
        SetupReadinessResponse: {
            readiness: {
                curriculum_assigned: boolean;
                price_set: boolean;
                support_instructor_set: boolean;
                published_content: boolean;
                cohort_active: boolean;
                catalog_copy: boolean;
                school_checkout_enabled: boolean;
            };
            school_checkout: {
                enabled: boolean;
                stripe_configured: boolean;
                webhook_configured: boolean;
            };
            errors: string[];
        };
        BulkEnrollmentResponse: {
            results: {
                row: number;
                email: string;
                /** @enum {string} */
                status: "enrolled" | "already_enrolled" | "duplicate" | "error" | "previously_dropped";
                error?: string;
                invitation_status?: string | null;
            }[];
        };
        PublicOfferingsResponse: {
            public_catalog_mode: string;
            offerings: components["schemas"]["PublicCourse"][];
        };
        /** @description Where the reported message was posted. `destination` is null when the viewing admin can't open that conversation (most direct conversations); show `label` as text then. */
        ContentReportConversation: {
            kind: "channel" | "dm";
            label: string;
            available: boolean;
            destination: components["schemas"]["RecordDestination"] | null;
        };
        SafetyBlockPerson: {
            id: number;
            full_name: string;
            email: string;
            role: string;
            archived: boolean;
        };
        SafetyUserBlock: {
            id: number;
            blocked_at: string;
            blocker: components["schemas"]["SafetyBlockPerson"];
            blocked_user: components["schemas"]["SafetyBlockPerson"];
        };
        SafetyUserBlocksResponse: {
            user_blocks: components["schemas"]["SafetyUserBlock"][];
            meta: components["schemas"]["PaginationMeta"];
        };
        TeamMemberTeaching: {
            cohort: {
                id: number;
                name: string;
                status: string;
                course_delivery: string;
                start_date: string;
            };
            assigned_at: string;
            can_edit_lessons: boolean;
            edit_granted_at: null | string;
            edit_granted_by: {
                id: number;
                full_name: string;
            } | null;
            /** @description Grading load: latest attempts without a grade in this cohort. */
            waiting_review: number;
            open_help: number;
        };
        TeamMember: {
            id: number;
            email: string;
            first_name: null | string;
            last_name: null | string;
            full_name: string;
            role: "instructor" | "admin";
            avatar_url: null | string;
            github_username: null | string;
            last_sign_in_at: null | string;
            archived_at: null | string;
            invite_pending: boolean;
            created_at: string;
            is_self: boolean;
            /** @description Cohorts this person teaches, running first. Admins aren't assigned to cohorts, so theirs is usually empty. */
            teaching: components["schemas"]["TeamMemberTeaching"][];
            /** @description A cohort whose workspace lets the viewer message this person; null when there is none or this is the viewer's own page. */
            message_cohort_id: null | number;
            workload: components["schemas"]["TeamMemberWorkload"];
        };
        TeamMemberResponse: {
            team_member: components["schemas"]["TeamMember"];
        };
        Announcement: {
            id: number;
            title: string;
            /** @description Markdown. A draft's body may be empty. */
            body: string;
            /** @enum {string} */
            audience: "cohort" | "global" | "staff";
            /** @enum {string} */
            status: "draft" | "published" | "archived";
            pinned: boolean;
            /** @description When the update was posted; null on a draft. */
            published_at: string | null;
            archived_at: string | null;
            cohort_id: number | null;
            cohort_name: string | null;
            author: {
                id: number;
                full_name: string;
                email: string;
            } | null;
            read_at: string | null;
            unread: boolean;
            /** @description When the title or body last changed after posting. Readers see "Edited". */
            edited_at: string | null;
            edited_by: {
                id: number;
                full_name: string;
            } | null;
            /** @description The viewer may edit, post or delete it: its author or an admin, who can still post to its audience. False for learners. */
            can_edit: boolean;
            /** @description The viewer may archive this posted update: an admin, or staff on its cohort. False for drafts (deleted instead, see can_edit), archived updates and learners. */
            can_archive: boolean;
            created_at: string;
            updated_at: string;
        };
        AnnouncementsResponse: {
            announcements: components["schemas"]["Announcement"][];
            unread_count: number;
            meta: components["schemas"]["PaginationMeta"];
        };
        AnnouncementResponse: {
            announcement: components["schemas"]["Announcement"];
        };
        InstructorToday: {
            items: {
                id: number | string;
                user_id: number;
                cohort_id: number | null;
                full_name: string;
                cohort_name: string | null;
                text: string;
                action_label: string;
                /** @enum {string} */
                kind: "help" | "review" | "message" | "quiet" | "follow_up";
                since: string | null;
                web_path: string | null;
                native_path: string | null;
                student_record: boolean;
                urgent: boolean;
            }[];
            counts: {
                help?: number;
                review?: number;
                message?: number;
                quiet?: number;
                follow_up?: number;
            };
            upcoming: {
                title: string;
                starts_at: string;
                web_path: string;
            }[];
            attention_remaining: number;
        };
        /** @description Set when this curriculum is one cohort's own copy: the cohort, the curriculum it was copied from (null once that is deleted) and when. */
        CurriculumCopyOrigin: {
            /** @description Null for an instructor who doesn’t teach that cohort. */
            cohort: {
                id: number;
                name: string;
            } | null;
            source_curriculum: null | {
                id: number;
                name: string;
            };
            /** Format: date-time */
            created_at: string;
        };
        /** @description Dry run of Make a copy for this cohort. Nothing is written. */
        CurriculumCopyPreview: {
            cohort: {
                id: number;
                name: string;
            };
            source_curriculum: null | {
                id: number;
                name: string;
            };
            /** @description The copy's name, e.g. "Web Development Bootcamp (Cohort 3)". */
            copy_name: string | null;
            /** @description The other cohorts that keep the shared curriculum and that the viewer may see by name. */
            shared_with: {
                id: number;
                name: string;
            }[];
            /** @description Other cohorts sharing the curriculum that the viewer doesn’t teach, as a number and never named. Always 0 for admins, who see every cohort. */
            shared_with_others_count: number;
            already_copied: boolean;
            /** @description The cohort's copy when already_copied. */
            copy_curriculum_id: number | null;
            can_copy: boolean;
            blockers: {
                /** @enum {string} */
                code: "source_missing" | "source_changed" | "copy_not_needed" | "not_allowed" | "source_archived" | "copied_before" | "unassigned_learner_work";
                message: string;
            }[];
            /** @description Rows per table: what the copy creates (modules, lessons, content_blocks, learning_objectives, rubrics, rubric_criteria, knowledge_checks, objective_alignments, curriculum_resources) and the cohort's rows it moves to the copy's ids (cohorts, cohort_module_schedules, cohort_module_submission_windows, module_assignments, lesson_assignments, progresses, submissions, submission_criterion_results, knowledge_check_attempts, learning_plans, learning_plan_revisions, help_requests, messages, notifications, activity_events). */
            counts: {
                [key: string]: number;
            };
        };
        CurriculumCopyPreviewResponse: {
            curriculum_copy_preview: components["schemas"]["CurriculumCopyPreview"];
        };
        CurriculumCopy: {
            id: number;
            cohort: {
                id: number;
                name: string;
            };
            source_curriculum: null | {
                id: number;
                name: string;
            };
            copy_curriculum: {
                id: number;
                name: string;
            };
            created_by: null | {
                id: number;
                full_name: string;
            };
            /** Format: date-time */
            created_at: string;
            /** @description True when this request found the copy an earlier request made. */
            already_copied: boolean;
            /** @description Rows per table: what the copy creates (modules, lessons, content_blocks, learning_objectives, rubrics, rubric_criteria, knowledge_checks, objective_alignments, curriculum_resources) and the cohort's rows it moves to the copy's ids (cohorts, cohort_module_schedules, cohort_module_submission_windows, module_assignments, lesson_assignments, progresses, submissions, submission_criterion_results, knowledge_check_attempts, learning_plans, learning_plan_revisions, help_requests, messages, notifications, activity_events). */
            counts: {
                [key: string]: number;
            };
            /** @description Shared lesson id (as a string key) => the copy's lesson id, so the editor can reopen the lesson it was on. */
            lesson_ids: {
                [key: string]: number;
            };
        };
        CurriculumCopyResponse: {
            curriculum_copy: components["schemas"]["CurriculumCopy"];
        };
        CurriculumCopyConflict: {
            /** @description A message to show as is. */
            error: string;
            /** @enum {string} */
            code: "busy" | "content_moved";
        };
        AnnouncementCreateRequest: {
            title: string;
            body: string;
            /** @enum {string} */
            audience: "cohort" | "global" | "staff";
            cohort_id?: number | null;
            /** @enum {string} */
            status?: "draft" | "published";
            pinned?: boolean;
            send_push?: boolean;
            /** @description One ID per composition, retained across retries. A replay returns the original record; reconcile changed fields with PATCH before accepting the save. */
            client_request_id?: string;
        };
        /** @description One row of the Grading workbench's queue. No answer text: the review loads GET /api/v1/submissions/{id}. */
        GradingQueueItem: {
            id: number;
            enrollment_id: number | null;
            latest_submission_id: number | null;
            content_block_id: number;
            user_id: number;
            user_name: string;
            /** @enum {string|null} */
            grade: "A" | "B" | "C" | "R" | null;
            graded_at: string | null;
            num_submissions: number;
            created_at: string;
            updated_at: string;
            content_block_title: string;
            content_block_type: string;
            lesson_id: number;
            lesson_title: string;
            module_id: number;
            module_name: string;
            module_position: number | null;
            cohort_id: number | null;
            cohort_name: string | null;
            /** @enum {string|null} */
            course_delivery: "program" | "guided" | "self_paced" | null;
            /** @description The lesson's program week; null for a self-paced cohort. */
            week_number: number | null;
        };
        /** @description Status chip counts inside the module, student and lesson filters. */
        GradingQueueCounts: {
            ungraded: number;
            redo: number;
            all: number;
        };
        /** @description A module or student with work in the chosen status (inside the other filters). The chosen one stays listed with count 0. */
        GradingQueueOption: {
            id: number;
            name: string;
            count: number;
        };
        /** @description A cohort and module in scope with any submissions, and how many latest attempts wait for review there. */
        GradingQueueModuleGrid: {
            cohort_id: number;
            cohort_name: string;
            module_id: number;
            module_name: string;
            waiting: number;
        };
        GradingQueueLesson: {
            id: number;
            title: string;
        };
        GradingQueueResponse: {
            submissions: components["schemas"]["GradingQueueItem"][];
            meta: components["schemas"]["PaginationMeta"];
            /** @description The item just before this page, so Previous keeps walking the list. */
            previous: components["schemas"]["GradingQueueItem"] | null;
            /** @description The item just after this page. */
            next: components["schemas"]["GradingQueueItem"] | null;
            counts: components["schemas"]["GradingQueueCounts"];
            modules: components["schemas"]["GradingQueueOption"][];
            students: components["schemas"]["GradingQueueOption"][];
            module_grids: components["schemas"]["GradingQueueModuleGrid"][];
            /** @description The lesson filter's title, when one is set. */
            lesson: components["schemas"]["GradingQueueLesson"] | null;
        };
        StudentWorkspaceStatus: {
            label: string;
            needs_attention: boolean;
            reasons: {
                code: string;
                label: string;
                since: string | null;
            }[];
            ungraded_count: number;
            redo_count: number;
            help_request_count: number;
            next_review_submission_id: number | null;
            active_intervention_count: number;
            active_intervention_id: number | null;
        };
        StudentWorkspaceEnrollment: {
            id: number;
            cohort_id: number;
            cohort_name: string;
            status: string;
        };
        StudentMediaSummary: {
            recordings_completed: number;
            recordings_total: number;
            lesson_videos_completed: number;
            lesson_videos_total: number;
            videos_completed: number;
        };
        StudentWorkspaceProgressResponse: {
            status: components["schemas"]["StudentWorkspaceStatus"] | null;
            enrollments: components["schemas"]["StudentWorkspaceEnrollment"][];
            media_summary: components["schemas"]["StudentMediaSummary"];
            personal_plan: components["schemas"]["PersonalLearningPlan"] | null;
            continue_lesson: {
                id: number;
                title: string;
            } | null;
            weekly_plan: components["schemas"]["WeeklyPlan"] | null;
            enrollment: {
                id: number;
                restart_version: string | null;
                status: string;
                access_expires_at: string | null;
                support_expires_at: string | null;
                first_opened_at: string | null;
                module_assignments: {
                    id: number;
                    module_id: number;
                    module_name: string;
                    module_type: string;
                    unlocked: boolean;
                    unlock_date_override: string | null;
                    available: boolean;
                    next_unlock_date: string | null;
                }[];
            };
            user: {
                id: number;
                full_name: string;
                email: string;
                github_username: string | null;
                avatar_url: string | null;
                last_sign_in_at: string | null;
                last_seen_at: string | null;
                last_active_at: string | null;
            };
            cohort: {
                id: number;
                name: string;
                start_date: string | null;
                status: string;
                /** @enum {unknown} */
                course_delivery: "program" | "guided" | "self_paced";
            };
            learning_evidence_scope: {
                /** @constant */
                kind: "enrollment";
                curriculum_id: number;
                curriculum_name: string;
                enrollment_count: number;
                /** @constant */
                shared_across_enrollments: false;
            };
            overall_progress: {
                completed: number;
                total: number;
                completed_lessons: number;
                total_lessons: number;
                percentage: number;
            };
            modules: {
                id: number;
                name: string;
                module_type: string;
                position: number;
                total_blocks: number;
                completed_blocks: number;
                progress_percentage: number;
                completed_lessons: number;
                total_lessons: number;
                lessons: {
                    id: number;
                    title: string;
                    lesson_type: string;
                    position: number;
                    release_day: number;
                    required: boolean;
                    review_status: string | null;
                    learner_status: components["schemas"]["LearnerLessonStatus"] | null;
                    submission_window: components["schemas"]["SubmissionWindowStatus"];
                    assigned: boolean;
                    available: boolean;
                    unlock_date: string | null;
                    total_blocks: number;
                    completed_blocks: number;
                    completed: boolean;
                    lesson_assignment: {
                        id: number;
                        unlocked: boolean;
                        unlock_date_override: string | null;
                    } | null;
                    blocks: {
                        id: number;
                        title: string | null;
                        block_type: string;
                        position: number;
                        status: string;
                        completed_at: string | null;
                        submission: {
                            id: number;
                            grade: string | null;
                            feedback: string | null;
                            submitted_at: string;
                            graded_at: string | null;
                        } | null;
                    }[];
                }[];
            }[];
            recent_activity: {
                content_block_id: number;
                block_title: string | null;
                block_type: string;
                completed_at: string | null;
            }[];
            can_message: boolean;
        };
        CohortModuleLearning: {
            id: number;
            assigned_count: number;
            assigned_enrollment_ids: number[];
            completed_lessons: number;
            total_lessons: number;
            progress_percentage: number;
            name: string;
            module_type: string;
            position: number;
            lessons_count: number;
            assigned: boolean;
            default_unlocked: boolean;
            unlocked_count: number;
            accessible_count: number;
            module_start_date: string | null;
            uses_default_start_date: boolean;
            requires_github: boolean;
            repository_name: string | null;
            week_count: number;
            submission_windows: components["schemas"]["SubmissionWindowStatus"][];
        };
        CohortWorkspaceResponse: {
            cohort: {
                id: number;
                /** @description Feature-switch map; feature names can evolve. */
                features: {
                    [key: string]: boolean;
                };
                name: string;
                cohort_type: string;
                course_delivery: string;
                public_checkout_enabled: boolean;
                offering_readiness: {
                    curriculum_assigned: boolean;
                    price_set: boolean;
                    support_instructor_set: boolean;
                    published_content: boolean;
                    cohort_active: boolean;
                };
                instructor_assigned: boolean;
                public_title: string | null;
                public_description: string | null;
                public_image_url: string | null;
                stripe_price_id: string | null;
                public_price_cents: number | null;
                support_instructor_id: number | null;
                self_paced_access_months: number;
                self_paced_support_weeks: number;
                guided_access_ends_on: string | null;
                guided_support_ends_on: string | null;
                curriculum_id: number;
                curriculum_name: string;
                start_date: string | null;
                end_date: string | null;
                github_organization_name: string | null;
                repository_name: string | null;
                requires_github: boolean;
                status: string;
                settings: {
                    [key: string]: unknown;
                } | null;
                enrolled_count: number;
                active_count: number;
                announcements: unknown[];
                recordings: unknown[];
                class_resources: unknown[];
                office_hours: {
                    id: number;
                    cohort_id: number;
                    title: string;
                    description: string | null;
                    starts_at: string;
                    ends_at: string;
                    meeting_url: string;
                    timezone: string;
                    recurrence: string;
                    event_kind: string;
                    active: boolean;
                    occurrences: components["schemas"]["OfficeHourOccurrence"][];
                    created_by: {
                        id: number;
                        full_name: string;
                        email: string;
                    } | null;
                }[];
                office_hour_occurrences: components["schemas"]["OfficeHourOccurrence"][];
                recording_library_count: number;
                uploaded_recordings_count: number;
                students: {
                    enrollment_id: number;
                    user_id: number;
                    full_name: string;
                    email: string;
                    github_username: string | null;
                    status: string;
                    enrolled_at: string | null;
                    invited_at: string | null;
                    joined_at: string | null;
                    last_sign_in_at: string | null;
                    last_seen_at: string | null;
                    last_active_at: string | null;
                    invite_sent_at: string | null;
                    invite_expires_at: string | null;
                    invite_last_error: string | null;
                    invite_pending: boolean;
                    invite_delivery_status: string | null;
                    invite_state: string;
                    module_assignments: {
                        id: number;
                        module_id: number;
                        module_name: string;
                        unlocked: boolean;
                        unlock_date_override: string | null;
                    }[];
                }[];
                modules: components["schemas"]["CohortModuleLearning"][];
                public_slug: string | null;
                public_outcomes: string | null;
                public_duration: string | null;
                public_prerequisites: string | null;
                public_preview: string | null;
            };
        };
        StudentCommunicationMessage: {
            id: number;
            body: string | null;
            created_at: string;
            author_name: string;
            direct_conversation_id: number | null;
            channel_id: number | null;
            parent_message_id: number | null;
            channel_name?: string;
            blocked: boolean;
            can_open: boolean;
        };
        StudentCommunicationMeeting: {
            id: number;
            starts_at: string;
            ends_at: string;
            status: string;
            instructor_name: string;
        };
        StudentCommunicationResponse: {
            communication: {
                messages: components["schemas"]["StudentCommunicationMessage"][];
                channel_activity: components["schemas"]["StudentCommunicationMessage"][];
                meetings: components["schemas"]["StudentCommunicationMeeting"][];
                can_message: boolean;
                channels: {
                    id: number;
                    name: string;
                }[];
            };
        };
        LearningInsightEvidenceContext: {
            id: string;
            /** @enum {unknown} */
            kind: "rubric_criterion" | "aligned_submission" | "knowledge_check";
            state: string;
            label: string;
            value: string;
            occurred_at: string;
            submission_id?: number;
            knowledge_check_id?: number;
            attempt_id?: number;
            attempt_count?: number;
            content_block_id: number;
            lesson_id: number;
            module_id: number;
            current_submission: boolean;
            github_checks: {
                total: number;
                passed: number;
                failed: number;
                pending: number;
            } | null;
            lesson_title: string;
            module_name: string;
        };
        LearningInsightContextResponse: {
            learning_insights: {
                generated_at: string;
                evidence_scope: {
                    /** @constant */
                    kind: "enrollment";
                    curriculum_id: number;
                    curriculum_name: string;
                    /** @constant */
                    completion_and_watch_time_excluded: true;
                };
                cohort: {
                    id: number;
                    name: string;
                };
                summary: {
                    objective_count: number;
                    learner_count: number;
                    demonstrated_count: number;
                    developing_count: number;
                    needs_revision_count: number;
                    not_evidenced_count: number;
                    open_redo_count: number;
                    revision_pattern_count: number;
                };
                rule: {
                    version: string;
                    demonstrated: string;
                    needs_revision: string;
                    developing: string;
                    not_evidenced: string;
                    automation_boundary: string;
                };
                objectives: {
                    id: number;
                    code: string;
                    title: string;
                    description: string | null;
                    success_criteria: string;
                    demonstrated_count: number;
                    learner_count: number;
                    demonstrated_percentage: number;
                    status_counts: {
                        demonstrated: number;
                        developing: number;
                        needs_revision: number;
                        not_evidenced: number;
                    };
                    students: {
                        enrollment_id: number;
                        user: {
                            id: number;
                            full_name: string;
                            email: string;
                        };
                        /** @enum {unknown} */
                        status: "demonstrated" | "developing" | "needs_revision" | "not_evidenced";
                        evidence_count: number;
                        last_evidence_at: string | null;
                        evidence: components["schemas"]["LearningInsightEvidenceContext"][];
                    }[];
                }[];
                revision_patterns: {
                    content_block: {
                        id: number;
                        title: string;
                    };
                    lesson: {
                        id: number;
                        title: string;
                    };
                    module: {
                        id: number;
                        name: string;
                    };
                    objective_ids: number[];
                    learners_with_work: number;
                    affected_learner_count: number;
                    open_redo_count: number;
                    repeat_attempt_count: number;
                    failed_check_count: number;
                    redo_percentage: number;
                    records: {
                        submission_id: number;
                        user: {
                            id: number;
                            full_name: string;
                        };
                        grade: string | null;
                        attempt_count: number;
                        github_checks: {
                            total: number;
                            passed: number;
                            failed: number;
                            pending: number;
                        };
                        updated_at: string;
                    }[];
                }[];
            };
        };
        LearningPlanMilestone: {
            title: string;
            due_on: string;
            lesson_ids: number[];
        };
        LearningPlanLessonOverride: {
            lesson_id: number;
            required: boolean;
            reason: string;
        };
        /** @description A saved learning plan as staff edit it. Students read the projection (PersonalLearningPlan), never this. */
        LearningPlanSnapshot: {
            active: boolean;
            title: string;
            description: string | null;
            target_date: string | null;
            next_check_in_on: string | null;
            milestones: components["schemas"]["LearningPlanMilestone"][];
            lesson_overrides: components["schemas"]["LearningPlanLessonOverride"][];
        };
        LearningPlanRecord: {
            active: boolean;
            title: string;
            description: string | null;
            target_date: string | null;
            next_check_in_on: string | null;
            milestones: components["schemas"]["LearningPlanMilestone"][];
            lesson_overrides: components["schemas"]["LearningPlanLessonOverride"][];
            id: number;
            lock_version: number;
            updated_at: string;
        };
        /** @description A lesson assigned to the student, in course order, with where this student stands on it. */
        LearningPlanEditorLesson: {
            id: number;
            title: string;
            module_id: number;
            module_name: string;
            standard_required: boolean;
            /** @description Week of the module the lesson releases in; null for self-paced courses, which show numbered sections instead. */
            week: number | null;
            status: components["schemas"]["LearnerLessonStatus"];
            /** @description Every step handed in (done or waiting for review), from LearnerProgress. */
            completed: boolean;
        };
        LearningPlanRevision: {
            id: number;
            author: string;
            created_at: string;
            snapshot: components["schemas"]["LearningPlanSnapshot"];
        };
        /** @description Staff-only learning plan editor payload for one enrollment. */
        LearningPlanManagement: {
            learning_plan: components["schemas"]["LearningPlanRecord"] | null;
            lessons: components["schemas"]["LearningPlanEditorLesson"][];
            revisions: components["schemas"]["LearningPlanRevision"][];
        };
        LearningPlanUpdateRequest: {
            learning_plan: {
                active: boolean;
                title?: string;
                description?: string | null;
                target_date?: string | null;
                next_check_in_on?: string | null;
                milestones?: components["schemas"]["LearningPlanMilestone"][];
                lesson_overrides?: components["schemas"]["LearningPlanLessonOverride"][];
                lock_version?: number;
            };
        };
        PrivateMeetingSlot: {
            id: number;
            starts_at: string;
            ends_at: string;
            instructor_id: number;
            instructor_name: string;
            available: boolean;
        };
        StaffPrivateMeetingBooking: {
            id: number;
            cohort_id: number;
            instructor_name: string;
            starts_at: string;
            ends_at: string;
            zoom_url: string | null;
            status: string;
            week_number: number;
            reschedule_count: number;
            student_name: string;
            student_id: number;
        };
        /** @description A cohort's meetings that the viewer hosts (or any cohort, for admins). */
        StaffPrivateMeetingCohort: {
            id: number;
            name: string;
            start_date: string;
            end_date: string | null;
            instructor_id: number;
            instructor_name: string;
            weeks: number;
            timezone: string;
            reschedule_cutoff_hours: number;
            max_student_changes: number;
            slots: components["schemas"]["PrivateMeetingSlot"][];
            bookings: components["schemas"]["StaffPrivateMeetingBooking"][];
        };
        StaffContact: {
            id: number;
            full_name: string;
        };
        /** @description A running cohort the instructor teaches, with meetings switched on, that someone else hosts or that has no host yet. */
        StaffMeetingOtherCohort: {
            id: number;
            name: string;
            /** @description Who hosts this cohort's meetings; null until an admin turns meetings on for it. */
            host: components["schemas"]["StaffContact"] | null;
        };
        StaffPrivateMeetingsResponse: {
            cohorts: components["schemas"]["StaffPrivateMeetingCohort"][];
            /** @description Empty for admins. */
            other_cohorts: components["schemas"]["StaffMeetingOtherCohort"][];
            /** @description Admins who can turn meetings on or change the host. Empty for admins. */
            admin_contacts: components["schemas"]["StaffContact"][];
        };
        /** @description One staff reply (U-4.7). `resolved_request` is true for the reply sent with Reply & resolve. */
        HelpRequestReply: {
            id: number;
            body: string;
            resolved_request: boolean;
            author: {
                id: number;
                full_name: string;
            };
            created_at: string;
        };
        /** @description The latest follow-up plan started from this request, in the request's cohort. */
        HelpRequestFollowUp: {
            id: number;
            status: components["schemas"]["InterventionStatus"];
            destination: components["schemas"]["RecordDestination"] | null;
        };
        HelpRequestReplyResponse: {
            help_request: components["schemas"]["HelpRequest"];
            reply: components["schemas"]["HelpRequestReply"];
            /** @description True when this was a retry: the reply saved by an earlier request with the same `client_request_id` is returned and nobody is notified again. */
            replayed: boolean;
        };
        PublicCourse: {
            id: number;
            name: string;
            description: string | null;
            image_url: string | null;
            curriculum_name: string;
            checkout_available: boolean;
            price_cents: number | null;
            currency: string;
            access_months: number;
            includes_private_meetings: boolean;
            instructor_message_weeks: number;
            instructor_response_target: string;
            includes_individual_project_review: boolean;
            outcomes: string | null;
            duration: string | null;
            prerequisites: string | null;
            preview: string | null;
            slug: string;
            lesson_count: number;
            syllabus: {
                title: string;
                lessons: string[];
            }[];
        };
        PublicCourseResponse: {
            offering: components["schemas"]["PublicCourse"];
        };
        StartHereDismissalResponse: {
            dismissed: boolean;
        };
        /** @description A cohort using the curriculum. */
        CurriculumUsageCohort: {
            id: number;
            name: string;
            /** @enum {string} */
            status: "upcoming" | "active" | "completed" | "archived";
            /** @enum {string} */
            course_delivery: "program" | "guided" | "self_paced";
            /** Format: date */
            start_date: string | null;
            /** Format: date */
            end_date: string | null;
            /** @description A self-paced course with public checkout on (an offering). */
            on_sale: boolean;
            students: number;
            /** @description Latest attempts without a grade, as Grading counts them. */
            waiting: number;
            /** @description Open help requests; null where help requests are switched off. */
            open_help: number | null;
        };
        /** @description A cohort’s schedule for the module; dates are null for self-paced cohorts. */
        ModuleUsageCohort: {
            id: number;
            name: string;
            /** @enum {string} */
            status: "upcoming" | "active" | "completed" | "archived";
            /** @enum {string} */
            course_delivery: "program" | "guided" | "self_paced";
            /** Format: date */
            start_date: string | null;
            /** Format: date */
            end_date: string | null;
            /** @description A self-paced course with public checkout on (an offering). */
            on_sale: boolean;
            /** @description False when the cohort’s content defaults leave this module out. */
            assigned: boolean;
            /** Format: date */
            starts_on: string | null;
            /** Format: date */
            ends_on: string | null;
            /** @description Every attempt, as Grading’s All filter counts them. */
            submissions: number;
            /** @description Latest attempts without a grade, as Grading counts them. */
            waiting: number;
            /** @description Open help requests; null where help requests are switched off. */
            open_help: number | null;
        };
        /** @description A cohort the lesson is used in. */
        LessonUsageCohort: {
            id: number;
            name: string;
            /** @enum {string} */
            status: "upcoming" | "active" | "completed" | "archived";
            /** @enum {string} */
            course_delivery: "program" | "guided" | "self_paced";
            /** Format: date */
            start_date: string | null;
            /** Format: date */
            end_date: string | null;
            /** @description A self-paced course with public checkout on (an offering). */
            on_sale: boolean;
            assigned: boolean;
            /**
             * Format: date
             * @description When the lesson opens in this cohort; null for self-paced cohorts and archived lessons.
             */
            release_date: string | null;
            /** @description Every attempt, as Grading’s All filter counts them. */
            submissions: number;
            /** @description Latest attempts without a grade, as Grading counts them. */
            waiting: number;
            /** @description Open help requests; null where help requests are switched off. */
            open_help: number | null;
        };
        UsageLessonRef: {
            id: number;
            title: string;
            module_id: number;
            archived: boolean;
        };
        /** @description Where a curriculum is used (staff). */
        CurriculumUsage: {
            /** @constant */
            type: "curriculum";
            id: number;
            name: string;
            description: string | null;
            /** @enum {string} */
            status: "draft" | "active" | "archived";
            total_weeks: number | null;
            /** @description Imported from a course package (ZIP). */
            imported: boolean;
            package_revision: string | null;
            /** @description Whether the viewer may edit its lessons (LessonEditAccess). */
            can_edit: boolean;
            modules: {
                id: number;
                name: string;
                module_type: string;
                position: number;
                scheduled_day_names: string[];
                lessons_count: number;
            }[];
            cohorts: components["schemas"]["CurriculumUsageCohort"][];
            /** @description Cohorts on the same curriculum the viewer doesn’t teach, as a number and never named. Always 0 for admins, who see every cohort. */
            other_cohorts_count: number;
            /** @description Set when this curriculum is one cohort’s own copy. */
            copy_of: {
                /** @description Null when the viewer doesn’t teach the cohort. */
                cohort: {
                    id: number;
                    name: string;
                } | null;
                source_curriculum: {
                    id: number;
                    name: string;
                } | null;
                created_by: {
                    id: number;
                    name: string;
                } | null;
                created_at: string;
            } | null;
            /** @description Copies made from this curriculum for cohorts the viewer can see, newest first. */
            copies: {
                id: number;
                cohort: {
                    id: number;
                    name: string;
                };
                copy_curriculum: {
                    id: number;
                    name: string;
                };
                created_by: {
                    id: number;
                    name: string;
                } | null;
                created_at: string;
                lessons_count: number | null;
            }[];
            other_copies_count: number;
            rubrics: {
                id: number;
                title: string;
                active: boolean;
                criteria_count: number;
                lessons: components["schemas"]["UsageLessonRef"][];
            }[];
            objectives: {
                id: number;
                code: string;
                title: string;
                active: boolean;
                lessons: components["schemas"]["UsageLessonRef"][];
            }[];
            totals: {
                waiting: number;
                open_help: number | null;
                resources: number;
            };
        };
        /** @description Where a module is used (staff). */
        ModuleUsage: {
            /** @constant */
            type: "module";
            id: number;
            name: string;
            description: string | null;
            module_type: string;
            scheduled_day_names: string[];
            week_count: number;
            curriculum: {
                id: number;
                name: string;
            };
            can_edit: boolean;
            lessons: {
                id: number;
                title: string;
                lesson_type: string;
                release_day: number;
                week: number;
                day_name: string;
                required: boolean;
                archived: boolean;
                has_work: boolean;
            }[];
            cohorts: components["schemas"]["ModuleUsageCohort"][];
            /** @description Cohorts on the same curriculum the viewer doesn’t teach, as a number and never named. Always 0 for admins, who see every cohort. */
            other_cohorts_count: number;
            totals: {
                submissions: number;
                waiting: number;
                open_help: number | null;
            };
        };
        /** @description Where a lesson is used (staff). */
        LessonUsage: {
            /** @constant */
            type: "lesson";
            id: number;
            title: string;
            lesson_type: string;
            required: boolean;
            archived: boolean;
            release_day: number;
            week: number;
            day_name: string;
            curriculum: {
                id: number;
                name: string;
            };
            module: {
                id: number;
                name: string;
            };
            can_edit: boolean;
            blocks: {
                id: number;
                block_type: string;
                title: string | null;
                has_work: boolean;
            }[];
            objectives: {
                id: number;
                code: string;
                title: string;
            }[];
            cohorts: components["schemas"]["LessonUsageCohort"][];
            /** @description Cohorts on the same curriculum the viewer doesn’t teach, as a number and never named. Always 0 for admins, who see every cohort. */
            other_cohorts_count: number;
            /** @description The newest open help requests on this lesson, up to five per cohort the viewer can see (no message text), newest first. */
            help_requests: {
                id: number;
                status: string;
                urgency: string;
                category: string;
                cohort_id: number;
                created_at: string;
                student: {
                    id: number;
                    name: string;
                } | null;
            }[];
            totals: {
                submissions: number;
                waiting: number;
                open_help: number | null;
            };
        };
        RecordUsageResponse: {
            usage: components["schemas"]["CurriculumUsage"] | components["schemas"]["ModuleUsage"] | components["schemas"]["LessonUsage"];
        };
        /** @description A person by id and display name. */
        RecordDetailPerson: {
            id: number;
            name: string;
        };
        /** @description A cohort the viewer can see. */
        RecordDetailCohort: {
            id: number;
            name: string;
            course_delivery: string;
            status: string;
        };
        RecordingDetail: {
            /** @constant */
            type: "recording";
            id: number;
            title: string;
            description: string | null;
            /** @enum {string} */
            status: "draft" | "published";
            source: string;
            /** @description The link for external recordings; null for uploads (stream through the recordings API). */
            url: string | null;
            duration_seconds: number | null;
            /** Format: date */
            recorded_date: string | null;
            /** Format: date-time */
            published_at: string | null;
            /** Format: date-time */
            created_at: string;
            uploaded_by: components["schemas"]["RecordDetailPerson"] | null;
            cohort: components["schemas"]["RecordDetailCohort"];
            /** @description Program week of the recorded date; null for self-paced or undated. */
            week: number | null;
            can_edit: boolean;
            lessons: {
                lesson: {
                    id: number;
                    title: string;
                    archived: boolean;
                };
                module: {
                    id: number;
                    name: string;
                };
                week: number | null;
                block: {
                    id: number;
                    title: string | null;
                };
                sections: {
                    label: string;
                    start_seconds: number;
                    end_seconds: number;
                    required: boolean;
                }[];
            }[];
            /** @description Learners in the cohort with read access. */
            students_count: number;
            /** @description Learners in the cohort who have started it, across every page. */
            watchers_count: number;
            /** @description Learners in the cohort who finished it. */
            completed_count: number;
            /** @description Pass as watchers_after for the next watchers, or null after the last. */
            watchers_next_after: number | null;
            /** @description Up to 25 watchers, in the order they started watching (a fixed order, so paging never skips or repeats anyone). */
            watchers: {
                student: components["schemas"]["RecordDetailPerson"];
                progress_percentage: number;
                completed: boolean;
                /** Format: date-time */
                last_watched_at: string | null;
            }[];
        };
        OfficeHourDetail: {
            /** @constant */
            type: "office_hour";
            id: number;
            title: string;
            description: string | null;
            /** @enum {string} */
            event_kind: "office_hours" | "live_class";
            /** @enum {string} */
            recurrence: "once" | "weekly";
            active: boolean;
            /** Format: date-time */
            starts_at: string;
            /** Format: date-time */
            ends_at: string;
            timezone: string;
            meeting_url: string;
            upcoming: {
                /** Format: date-time */
                starts_at: string;
                /** Format: date-time */
                ends_at: string;
            }[];
            cohort: components["schemas"]["RecordDetailCohort"];
            scheduled_by: components["schemas"]["RecordDetailPerson"] | null;
            teaching_team: components["schemas"]["RecordDetailPerson"][];
            /** @description Active learners in the cohort. Attendance isn't recorded. */
            invited_count: number;
            can_edit: boolean;
        };
        PrivateMeetingDetail: {
            /** @constant */
            type: "private_meeting";
            id: number;
            /** @enum {string} */
            status: "confirmed" | "canceled";
            /** Format: date-time */
            starts_at: string;
            /** Format: date-time */
            ends_at: string;
            week_number: number;
            timezone: string;
            zoom_url: string | null;
            reschedule_count: number;
            cohort: components["schemas"]["RecordDetailCohort"];
            student: components["schemas"]["RecordDetailPerson"];
            host: components["schemas"]["RecordDetailPerson"];
            /** @description The viewer's own conversation with the student in this cohort, if one exists. */
            direct_conversation_id: number | null;
            history: {
                action: string;
                actor: components["schemas"]["RecordDetailPerson"];
                /** Format: date-time */
                created_at: string;
                /** Format: date-time */
                previous_starts_at: string | null;
            }[];
        };
        LearningPlanDetail: {
            /** @constant */
            type: "learning_plan";
            id: number;
            title: string;
            description: string | null;
            active: boolean;
            /** Format: date */
            target_date: string | null;
            /** Format: date */
            next_check_in_on: string | null;
            /** Format: date-time */
            updated_at: string;
            cohort: components["schemas"]["RecordDetailCohort"];
            student: components["schemas"]["RecordDetailPerson"];
            enrollment_status: string;
            lesson_exceptions_count: number;
            milestones: {
                title: string;
                /** Format: date */
                due_on: string | null;
                completed_count: number;
                lessons: {
                    id: number;
                    title: string;
                    module_id: number | null;
                    module_name: string | null;
                    status: string | null;
                    completed: boolean;
                    assigned: boolean;
                }[];
            }[];
            revisions_count: number;
            revisions: {
                id: number;
                author: components["schemas"]["RecordDetailPerson"];
                /** Format: date-time */
                created_at: string;
                /** @description Parts that changed from the revision before, or ["created"] for the first. */
                changes: string[];
            }[];
        };
        ChannelDetail: {
            /** @constant */
            type: "channel";
            id: number;
            name: string;
            description: string | null;
            /** @enum {string} */
            visibility: "cohort" | "staff_only";
            /** @enum {string} */
            status: "active" | "archived";
            cohort: components["schemas"]["RecordDetailCohort"] | null;
            workspace: {
                id: number;
                name: string;
                workspace_type: string;
            };
            can_manage: boolean;
            members: {
                count: number;
                staff_count: number;
                /** @description The first 50 members for admins; null for instructors, who get the counts. */
                list: {
                    id: number;
                    name: string;
                    role: string;
                }[] | null;
            };
            activity: {
                messages_count: number;
                last_7_days: number;
                /** Format: date-time */
                last_message_at: string | null;
                recent: {
                    id: number;
                    author: components["schemas"]["RecordDetailPerson"];
                    /** Format: date-time */
                    created_at: string;
                    hidden: boolean;
                    /** @description One line; "Message hidden" when either person blocked the other. */
                    preview: string;
                }[];
            };
        };
        RubricDetail: {
            /** @constant */
            type: "rubric";
            id: number;
            title: string;
            description: string | null;
            active: boolean;
            curriculum: {
                id: number;
                name: string;
            };
            can_edit: boolean;
            criteria: {
                id: number;
                title: string;
                description: string;
                objective: {
                    id: number;
                    code: string;
                    title: string;
                } | null;
            }[];
            uses: {
                lesson: {
                    id: number;
                    title: string;
                    archived: boolean;
                };
                module: {
                    id: number;
                    name: string;
                };
                block: {
                    id: number;
                    title: string | null;
                    block_type: string;
                };
                /** @description Graded latest attempts in cohorts the viewer can count. */
                graded: number;
            }[];
            cohorts: components["schemas"]["RecordDetailCohort"][];
            /** @description Cohorts on the curriculum the viewer doesn't teach, as a number, never named. */
            other_cohorts_count: number;
        };
        ActivityEventDetail: {
            /** @constant */
            type: "activity_event";
            id: number;
            event_type: string;
            category: string | null;
            /** @enum {string} */
            evidence: "server_record" | "player_reported";
            /** Format: date-time */
            created_at: string;
            actor: {
                id: number;
                name: string;
                role: string;
            };
            subject: {
                id: number;
                name: string;
                role: string;
            };
            /** @description Null when the event has no cohort or the viewer can't see it. */
            cohort: components["schemas"]["RecordDetailCohort"] | null;
            record_type: string | null;
            record_label: string | null;
            /** @description The subject record, when it belongs to the event's cohort and learner. */
            record: {
                /** @enum {string} */
                kind: "submission" | "lesson" | "recording";
                id: number;
                cohort_id: number;
                student_id: number;
                lesson_id: number | null;
                content_block_id: number | null;
            } | null;
        };
        RecordDetailResponse: {
            detail: components["schemas"]["RecordingDetail"] | components["schemas"]["OfficeHourDetail"] | components["schemas"]["PrivateMeetingDetail"] | components["schemas"]["LearningPlanDetail"] | components["schemas"]["ChannelDetail"] | components["schemas"]["RubricDetail"] | components["schemas"]["ActivityEventDetail"];
        };
        TeamMemberWorkload: {
            /** @description Active follow-up plans this person owns. */
            follow_ups_count: number;
            /** @description Up to 10 of them, soonest follow-up first. */
            follow_ups: {
                id: number;
                status: string;
                severity: string;
                next_follow_up_at: string | null;
                student: {
                    id: number;
                    name: string;
                };
                cohort: {
                    id: number;
                    name: string;
                };
            }[];
            /** @description Open or acknowledged help requests this person owns. */
            owned_help_count: number;
        };
        /**
         * @description What a lesson is to a learner, read from its blocks (LessonKind). The stored lesson_type is not reliable: imports store exercise for nearly every lesson.
         * @enum {string}
         */
        LessonKind: "exercise" | "project" | "video" | "recording" | "checkpoint" | "reading";
        CourseOutlineLesson: {
            id: number;
            title: string;
            kind: components["schemas"]["LessonKind"];
            /** @description Position in course order among the learner's listed lessons, from 1. */
            number: number;
            status: components["schemas"]["LearnerLessonStatus"];
            required: boolean;
            available: boolean;
            /** @description Unlock date of a locked lesson in a dated program; null when open or self-paced. */
            opens_on: string | null;
            /** @description The learner can act on it now (LearnerProgress#actionable?). False while the enrollment is paused or ended, and in the library. */
            todo: boolean;
            /** @description The block a Redo was requested on, for a #block- anchor. */
            redo_block_id: number | null;
        };
        CourseOutlineNextLesson: {
            id: number;
            title: string;
            kind: components["schemas"]["LessonKind"];
            /** @description Position in course order among the learner's listed lessons, from 1. */
            number: number;
            status: components["schemas"]["LearnerLessonStatus"];
            required: boolean;
            available: boolean;
            /** @description Unlock date of a locked lesson in a dated program; null when open or self-paced. */
            opens_on: string | null;
            /** @description The learner can act on it now (LearnerProgress#actionable?). False while the enrollment is paused or ended, and in the library. */
            todo: boolean;
            /** @description The block a Redo was requested on, for a #block- anchor. */
            redo_block_id: number | null;
            module_id: number;
            group_key: string | null;
        };
        /** @description Counted lessons and how many are complete, by LearnerProgress.lesson_counts. */
        CourseOutlineCounts: {
            completed_lessons: number;
            total_lessons: number;
        };
        CourseOutlineGroup: {
            key: string;
            /** @description "Week 3" in programs, "Part 2 · lessons 21–40" in a split self-paced section, null for a single group. */
            label: string | null;
            week: number | null;
            opens_on: string | null;
            available: boolean;
            /** @description Holds the next lesson; Learn opens it. */
            current: boolean;
            /** @description The program week that opened most recently. */
            this_week: boolean;
            counts: components["schemas"]["CourseOutlineCounts"] | null;
            lessons: components["schemas"]["CourseOutlineLesson"][];
        };
        CourseOutlineModule: {
            id: number;
            name: string;
            number: number;
            available: boolean;
            counts: components["schemas"]["CourseOutlineCounts"] | null;
            groups: components["schemas"]["CourseOutlineGroup"][];
        };
        /** @description One course outline for every delivery mode (CourseOutline): the redesigned Learn page. Statuses, counts and the next lesson come from LearnerProgress. */
        CourseOutline: {
            /** @enum {string} */
            mode: "program" | "self_paced" | "library";
            cohort: {
                id: number;
                name: string;
                cohort_type: string;
                course_delivery: string;
            };
            course_title: string;
            enrollment_status: string;
            paused_since: string | null;
            read_only: boolean;
            counts: components["schemas"]["CourseOutlineCounts"] | null;
            course_week: {
                current: number;
                total: number;
            } | null;
            lesson_count: number;
            next_lesson: components["schemas"]["CourseOutlineNextLesson"] | null;
            current_group_key: string | null;
            filters: {
                todo: number;
                redo: number;
            };
            modules: components["schemas"]["CourseOutlineModule"][];
        };
        CourseOutlineResponse: {
            outline: components["schemas"]["CourseOutline"];
        };
        /** @description LearnerProgress continuation, completion and course reading order for the new student experience. */
        LessonNavigation: {
            number: number;
            total: number;
            previous: {
                id: number;
                title: string;
                module_id: number;
            } | null;
            next: {
                id: number;
                title: string;
                module_id: number;
            } | null;
            next_module: boolean;
            course_complete: boolean;
            counts: {
                completed_lessons: number;
                total_lessons: number;
            };
            manual_block_ids: number[];
            next_redo: boolean;
        };
        /** @description A person named on a learner page: only an id and a name. */
        PersonName: {
            id: number;
            full_name: string;
        };
        /** @description One latest attempt in My work, from LearnerProgress (redo_submissions, awaiting_review_submissions, graded_submissions). */
        MyWorkItem: {
            submission_id: number;
            /** @enum {string} */
            status: "redo" | "waiting" | "graded";
            cohort_id: number;
            lesson_id: number;
            content_block_id: number;
            lesson_title: string;
            block_title: string;
            module_name: string | null;
            /** @description Curriculum week in a dated program; null when self-paced or in the library. */
            week: number | null;
            attempt: number;
            grade: string | null;
            /** @description Markdown. Null while waiting for review. */
            feedback: string | null;
            submitted_at: string;
            graded_at: string | null;
            grader: components["schemas"]["PersonName"] | null;
            submission_type: string | null;
            submissions_closed: boolean;
            /** @description A redo the learner can resubmit here now: active enrollment, the lesson open to them, an open window and a submission form. */
            can_resubmit: boolean;
            /** @description Who Ask about this feedback messages: the grader while reachable, else the cohort contact. Null (and always null while waiting) means no action. */
            ask_to: components["schemas"]["PersonName"] | null;
        };
        /** @description A learner's submitted work in one cohort (MyWork): redos, work waiting for review, and graded work. */
        MyWork: {
            cohort: {
                id: number;
                name: string;
            };
            read_only: boolean;
            review_response_time: string;
            reviewer: components["schemas"]["PersonName"] | null;
            /** @description Each count is its list's length. */
            counts: {
                needs_you: number;
                waiting: number;
                graded: number;
            };
            needs_you: components["schemas"]["MyWorkItem"][];
            waiting: components["schemas"]["MyWorkItem"][];
            graded: components["schemas"]["MyWorkItem"][];
            /** @description Someone the learner can message about the course now (StaffContact): the reviewer if reachable, else another current instructor. Null hides message actions. */
            contact: components["schemas"]["PersonName"] | null;
        };
        MyWorkResponse: {
            my_work: components["schemas"]["MyWork"];
        };
        /** @description A redo with its feedback (MyWorkItem plus kind). */
        StudentTodayRedo: {
            submission_id: number;
            /** @enum {string} */
            status: "redo" | "waiting" | "graded";
            cohort_id: number;
            lesson_id: number;
            content_block_id: number;
            lesson_title: string;
            block_title: string;
            module_name: string | null;
            /** @description Curriculum week in a dated program; null when self-paced or in the library. */
            week: number | null;
            attempt: number;
            grade: string | null;
            /** @description Markdown. Null while waiting for review. */
            feedback: string | null;
            submitted_at: string;
            graded_at: string | null;
            grader: components["schemas"]["PersonName"] | null;
            submission_type: string | null;
            submissions_closed: boolean;
            /** @description A redo the learner can resubmit here now (active enrollment, open window, a submission form). */
            can_resubmit: boolean;
            /** @constant */
            kind: "redo";
            /** @description Who Ask about this feedback messages: the grader while reachable, else the cohort contact. Null (and always null while waiting) means no action. */
            ask_to: components["schemas"]["PersonName"] | null;
        };
        /** @description A staff reply to the learner's help request whose notification is unread. */
        StudentTodayHelpAnswer: {
            /** @constant */
            kind: "help_answer";
            help_request_id: number;
            notification_id: number;
            context_label: string;
            /** @description The lesson with the request's dialog open (help_request=:id). */
            path: string;
            replied_by: components["schemas"]["PersonName"] | null;
            replied_at: string | null;
            excerpt: string;
            resolved: boolean;
        };
        /** @description The newest unread message from staff in one of the learner's conversations for this cohort. */
        StudentTodayMessage: {
            /** @constant */
            kind: "message";
            message_id: number;
            direct_conversation_id: number;
            author: components["schemas"]["PersonName"];
            excerpt: string;
            sent_at: string;
        };
        StudentTodayLesson: {
            lesson_id: number;
            title: string;
            kind: components["schemas"]["LessonKind"];
            due_on: string | null;
            available: boolean;
            status: components["schemas"]["LearnerLessonStatus"];
        };
        /** @description The redesigned student Today (StudentToday). Every status, count and next step comes from LearnerProgress. */
        StudentToday: {
            /** @enum {string} */
            mode: "program" | "self_paced" | "library";
            read_only: boolean;
            paused: boolean;
            course_week: {
                current: number;
                total: number;
            } | null;
            counts: components["schemas"]["CourseOutlineCounts"] | null;
            next_lesson: {
                id: number;
                title: string;
                kind: components["schemas"]["LessonKind"];
                module_id: number;
                module_name: string;
                week: number | null;
                number: number;
                position: number;
                module_lesson_count: number;
                status: components["schemas"]["LearnerLessonStatus"];
            } | null;
            this_week: {
                total: number;
                completed: number;
                ends_on: string;
            } | null;
            pace: {
                behind: boolean;
                weeks_behind: number;
                overdue_count: number;
            } | null;
            catch_up_plan: {
                title: string;
                target_date: string | null;
                agreed_at: string;
                agreed_by: components["schemas"]["PersonName"] | null;
                remaining_count: number;
                items: components["schemas"]["StudentTodayLesson"][];
            } | null;
            /** @description Every redo, unread help answer and conversation with an unread staff message; count equals items. */
            needs_you: {
                count: number;
                items: (components["schemas"]["StudentTodayRedo"] | components["schemas"]["StudentTodayHelpAnswer"] | components["schemas"]["StudentTodayMessage"])[];
            };
            /** @description count is every submission waiting for review (My work's Waiting count); items are the first five. */
            waiting: {
                count: number;
                items: components["schemas"]["MyWorkItem"][];
            };
            recently_graded: components["schemas"]["MyWorkItem"][];
            reviews_count: number;
            /** @description Every help request still waiting for a first reply (count equals items). Empty when help requests are off. */
            questions: {
                count: number;
                items: {
                    id: number;
                    status: components["schemas"]["HelpRequestStatus"];
                    context_label: string;
                    message: string;
                    created_at: string;
                    path: string;
                }[];
            };
            next_session: components["schemas"]["OfficeHourOccurrence"] | null;
            reviewer: components["schemas"]["PersonName"] | null;
            review_response_time: string;
            support: {
                /** @enum {string} */
                mode: "guided_help" | "course_question" | "none";
                live_support: boolean;
                ends_on: string | null;
                ended: boolean;
            };
            recently_added: {
                id: number;
                title: string;
                kind: components["schemas"]["LessonKind"];
            }[];
            /** @description Someone the learner can message now (StaffContact). Null hides every message action. */
            contact: components["schemas"]["PersonName"] | null;
            /** @description Offer Ask for a catch-up plan: an active program enrollment, learning plans on and a reachable contact. */
            can_ask_for_plan: boolean;
        };
    };
    responses: {
        /** @description ApiError */
        401: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description ApiError */
        403: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description ApiRequestError */
        404: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiNotFoundError"];
            };
        };
        /** @description ApiRequestError */
        422: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiRequestError"];
            };
        };
        /** @description ApiRateLimitError */
        429: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiTooManyRequestsError"];
            };
        };
    };
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    searchEverything: {
        parameters: {
            query?: {
                /** @description Two characters minimum; simple full-text prefix matching. */
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Authorized results grouped by type */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SearchResponse"];
                };
            };
        };
    };
    getAccessibleCohorts: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Accessible cohort summaries; excludes student lists and management details. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccessibleCohortsResponse"];
                };
            };
        };
    };
}
