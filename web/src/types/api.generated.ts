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
                query?: never;
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
                query?: never;
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
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ManagedCurriculaResponse"];
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
                /** @description Successful response */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ManagedCurriculumResponse"];
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
                        "application/json": components["schemas"]["ManagedCurriculumResponse"];
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
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ManagedCurriculumResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/modules/{id}": {
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
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
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
                /** @description Successful response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ManagedModuleResponse"];
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
                /** @description Successful response */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ManagedModuleResponse"];
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
    "/api/v1/curricula/{curriculum_id}/modules/reorder": {
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
            /** @description Included only in the relevant role or response context. */
            email?: string;
            role: string;
            avatar_url: string | null;
            /** @description Included only in the relevant role or response context. */
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
            /** @description Included only in the relevant role or response context. */
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
        MessageSourceType: "lesson" | "submission" | "help_request";
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
            /** @description Included only for the message author; nullable if no client id was supplied. */
            client_message_id?: string | null;
            /** @description Included only in the relevant role or response context. */
            blocked: boolean;
            attachments: components["schemas"]["MessageAttachment"][];
            /** @description Included only in the relevant role or response context. */
            reply_count: number;
            /** @description Included only in the relevant role or response context. */
            sent_via_label: string | null;
            reactions: components["schemas"]["MessageReaction"][];
            /** @description Included only in the relevant role or response context. */
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
            /** @description Included only in the relevant role or response context. */
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
            /** @description Included only for accepted messages whose delivery is pending. */
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
                /** @description Included only for the message author; nullable if no client id was supplied. */
                client_message_id?: string | null;
                /** @description Included only in the relevant role or response context. */
                blocked: boolean;
                attachments: components["schemas"]["MessageAttachment"][];
                /** @description Included only in the relevant role or response context. */
                reply_count: number;
                /** @description Included only in the relevant role or response context. */
                sent_via_label: string | null;
                reactions: components["schemas"]["MessageReaction"][];
                /** @description Included only in the relevant role or response context. */
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
                /** @description Included only in the relevant role or response context. */
                course_delivery: "program" | "guided" | "self_paced";
                features: {
                    [key: string]: boolean;
                };
            };
            status: string;
            enrolled_at: string | null;
            /** @description Included only in the relevant role or response context. */
            access_expires_at: string | null;
            /** @description Included only in the relevant role or response context. */
            first_opened_at: string | null;
            /** @description Included only in the relevant role or response context. */
            support_expires_at: string | null;
        };
        ProfileEnrollment: {
            id: number;
            cohort_name: string;
            curriculum_name: string;
            status: string;
            enrolled_at: string | null;
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
            /** @description Included only in the relevant role or response context. */
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
            /** @description Included only in the relevant role or response context. */
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
            /** @description Included only in the relevant role or response context. */
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
        };
        ContentReportsResponse: {
            content_reports: components["schemas"]["ContentReport"][];
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
            /** @description Included for feature_disabled. */
            feature?: string;
            /** @description Included when community terms acceptance is required. */
            community_policy?: components["schemas"]["CommunityPolicy"];
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
        /** @description Rails exception middleware envelope in local/test environments for unhandled RecordNotFound; traces are environment-dependent. */
        RailsNotFoundError: {
            /** @constant */
            status: 404;
            error: string;
            exception: string;
            traces: {
                [key: string]: Record<string, never>[];
            };
        };
        ApiNotFoundError: components["schemas"]["ApiRequestError"] | components["schemas"]["RailsNotFoundError"];
        ChannelShowResponse: {
            channel: components["schemas"]["ChannelSummary"];
            /** @description Included on show responses only. */
            messages: components["schemas"]["ChannelMessage"][];
            /** @description Included on show responses only. */
            pinned_messages: components["schemas"]["ChannelMessage"][];
            /** @description Included on show responses only. */
            meta: components["schemas"]["MessageWindowMeta"];
        };
        DirectConversationShowResponse: {
            direct_conversation: components["schemas"]["DirectConversationSummary"];
            /** @description Included on show responses only. */
            messages: components["schemas"]["ChannelMessage"][];
            /** @description Included on show responses only. */
            pinned_messages: components["schemas"]["ChannelMessage"][];
            /** @description Included on show responses only. */
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
        ManagedCurriculum: {
            id: number;
            name: string;
            description: string | null;
            total_weeks: number | null;
            /** @enum {string} */
            status: "draft" | "active" | "archived";
            updated_at: string;
            modules_count: number;
            archive_blocked: boolean;
            modules?: components["schemas"]["ManagedModule"][];
            live_checkout_offerings?: {
                id: number;
                name: string;
            }[];
            active_self_paced_learners?: boolean;
        };
        ManagedModule: {
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
            submissions_count: number;
            deletion_blocked: boolean;
            lessons?: {
                id: number;
                title: string;
                lesson_type: string;
                position: number;
                release_day: number;
                required: boolean;
                archived_at: string | null;
                updated_at: string;
                requires_submission: boolean;
                submission_type: string;
                content_blocks_count: number;
            }[];
        };
        ManagedCurriculumResponse: {
            curriculum: components["schemas"]["ManagedCurriculum"];
        };
        ManagedModuleResponse: {
            module: components["schemas"]["ManagedModule"];
        };
        ManagedCurriculaResponse: {
            curricula: components["schemas"]["ManagedCurriculum"][];
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
export type operations = Record<string, never>;
