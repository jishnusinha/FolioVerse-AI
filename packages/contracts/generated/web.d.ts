/* Generated from openapi/api.json by scripts/generate.mjs. Do not edit. */
export interface paths {
    "/api/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["HealthController_live"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["HealthController_ready"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/csrf": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AuthController_csrf"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController_register"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController_login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController_refresh"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController_logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AuthController_me"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["AuthController_updateMe"];
        trace?: never;
    };
    "/api/auth/verify-email": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController_verify"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/resend-verification": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController_resend"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/forgot-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController_forgot"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/reset-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController_reset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WorkspacesController_list"];
        put?: never;
        post: operations["WorkspacesController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WorkspacesController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["WorkspacesController_rename"];
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WorkspacesController_members"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/members/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["WorkspacesController_remove"];
        options?: never;
        head?: never;
        patch: operations["WorkspacesController_setRole"];
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/invitations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["WorkspacesController_invite"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/invitations/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["WorkspacesController_accept"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WorkspacesController_auditLog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProjectsController_list"];
        put?: never;
        post: operations["ProjectsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/projects/{projectId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProjectsController_get"];
        put?: never;
        post?: never;
        delete: operations["ProjectsController_trash"];
        options?: never;
        head?: never;
        patch: operations["ProjectsController_update"];
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/projects/{projectId}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ProjectsController_restore"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/trash": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProjectsController_trashList"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/projects/{projectId}/folders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProjectsController_folders"];
        put?: never;
        post: operations["ProjectsController_createFolder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/folders/{folderId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["ProjectsController_deleteFolder"];
        options?: never;
        head?: never;
        patch: operations["ProjectsController_updateFolder"];
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SourcesController_createUpload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/uploads/{uploadId}/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SourcesController_upload"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/uploads/{uploadId}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SourcesController_complete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/projects/{projectId}/sources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SourcesController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/sources/{sourceId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SourcesController_get"];
        put?: never;
        post?: never;
        delete: operations["SourcesController_remove"];
        options?: never;
        head?: never;
        patch: operations["SourcesController_update"];
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/sources/{sourceId}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SourcesController_restore"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/sources/batch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SourcesController_batch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/sources/{sourceId}/versions/{versionId}/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SourcesController_file"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/sources/{sourceId}/versions/{versionId}/pages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SourcesController_pages"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/sources/{sourceId}/versions/{versionId}/diff": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SourcesController_diff"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/sources/{sourceId}/versions/{versionId}/chunks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SourcesController_chunks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/sources/{sourceId}/versions/{versionId}/ingest": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SourcesController_reingest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["RunsController_list"];
        put?: never;
        post: operations["RunsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/runs/{runId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["RunsController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/runs/{runId}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["RunsController_cancel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/runs/{runId}/receipt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["RunsController_receipt"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/runs/{runId}/trace": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["RunsController_trace"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/runs/{runId}/checkpoints": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["RunsController_checkpoints"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/runs/{runId}/checkpoints/{checkpointId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["RunsController_checkpoint"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/runs/{runId}/fork": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["RunsController_fork"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/budget": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["RunsController_budget"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/graphs/{name}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["RunsController_graph"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/runs/{runId}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SseController_runEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SseController_workspaceEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/threads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ThreadsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/threads/{threadId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ThreadsController_get"];
        put?: never;
        post?: never;
        delete: operations["ThreadsController_remove"];
        options?: never;
        head?: never;
        patch: operations["ThreadsController_update"];
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/threads/{threadId}/scope": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["ThreadsController_setScope"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/costs/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CostsController_summary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/costs/estimate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CostsController_estimate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/costs/anomalies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CostsController_anomalies"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/costs/entries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CostsController_entries"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/costs/export.csv": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CostsController_csv"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ModelsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NotificationsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/notifications/read-all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["NotificationsController_readAll"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/insight-actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["InsightsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/artifacts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ArtifactsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/artifacts/{artifactId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ArtifactsController_get"];
        put?: never;
        post?: never;
        delete: operations["ArtifactsController_remove"];
        options?: never;
        head?: never;
        patch: operations["ArtifactsController_update"];
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/notes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NotesController_list"];
        put?: never;
        post: operations["NotesController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/notes/{noteId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["NotesController_remove"];
        options?: never;
        head?: never;
        patch: operations["NotesController_update"];
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SearchController_search"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/manuscripts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ManuscriptsController_list"];
        put?: never;
        post: operations["ManuscriptsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/manuscripts/{manuscriptId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ManuscriptsController_get"];
        put?: never;
        post?: never;
        delete: operations["ManuscriptsController_remove"];
        options?: never;
        head?: never;
        patch: operations["ManuscriptsController_update"];
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/manuscripts/{manuscriptId}/nodes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ManuscriptsController_createNode"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/manuscripts/{manuscriptId}/nodes/{nodeId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["ManuscriptsController_removeNode"];
        options?: never;
        head?: never;
        patch: operations["ManuscriptsController_updateNode"];
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/manuscripts/{manuscriptId}/nodes/{nodeId}/doc": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ManuscriptsController_getDoc"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["ManuscriptsController_saveDoc"];
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/manuscripts/{manuscriptId}/nodes/{nodeId}/doc/revisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ManuscriptsController_revisions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/manuscripts/{manuscriptId}/nodes/{nodeId}/doc/revisions/{revision}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ManuscriptsController_revision"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/manuscripts/{manuscriptId}/nodes/{nodeId}/doc/revisions/{revision}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ManuscriptsController_restore"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/manuscripts/{manuscriptId}/compiled": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ManuscriptsController_compiledView"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/manuscripts/{manuscriptId}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ManuscriptsController_export"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/manuscripts/{manuscriptId}/suggestions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SuggestionsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/manuscripts/{manuscriptId}/nodes/{nodeId}/suggestions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SuggestionsController_request"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/suggestions/{suggestionId}": {
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
        patch: operations["SuggestionsController_update"];
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/manuscripts/{manuscriptId}/dna": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DnaController_dna"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/manuscripts/{manuscriptId}/dna/facts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DnaController_createFact"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/manuscripts/{manuscriptId}/dna/facts/{factId}": {
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
        patch: operations["DnaController_updateFact"];
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/manuscripts/{manuscriptId}/dna/links": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DnaController_createLink"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/manuscripts/{manuscriptId}/dna/links/{linkId}": {
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
        patch: operations["DnaController_updateLink"];
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/manuscripts/{manuscriptId}/dna/extract": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DnaController_extract"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/manuscripts/{manuscriptId}/continuity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DnaController_issues"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/manuscripts/{manuscriptId}/continuity/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DnaController_check"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/manuscripts/{manuscriptId}/continuity/{issueId}": {
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
        patch: operations["DnaController_updateIssue"];
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/excerpts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ResearchController_excerpts"];
        put?: never;
        post: operations["ResearchController_createExcerpt"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/excerpts/{excerptId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["ResearchController_removeExcerpt"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/manuscripts/{manuscriptId}/research-notes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ResearchController_notes"];
        put?: never;
        post: operations["ResearchController_createNote"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/manuscripts/{manuscriptId}/research-notes/{noteId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["ResearchController_removeNote"];
        options?: never;
        head?: never;
        patch: operations["ResearchController_updateNote"];
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/library/items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["LibraryController_list"];
        put?: never;
        post: operations["LibraryController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/library/items/{itemId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["LibraryController_detail"];
        put?: never;
        post?: never;
        delete: operations["LibraryController_remove"];
        options?: never;
        head?: never;
        patch: operations["LibraryController_update"];
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/library/items/{itemId}/progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["LibraryController_progress"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/library/items/{itemId}/annotations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["LibraryController_annotations"];
        put?: never;
        post: operations["LibraryController_createAnnotation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/library/items/{itemId}/annotations/{annotationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["LibraryController_removeAnnotation"];
        options?: never;
        head?: never;
        patch: operations["LibraryController_updateAnnotation"];
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/library/items/{itemId}/bookmarks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["LibraryController_bookmarks"];
        put?: never;
        post: operations["LibraryController_createBookmark"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/library/items/{itemId}/bookmarks/{bookmarkId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["LibraryController_removeBookmark"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/library/items/{itemId}/explain": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["LibraryController_explain"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/library/items/{itemId}/excerpts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["LibraryController_excerpt"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/library/collections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["LibraryController_collections"];
        put?: never;
        post: operations["LibraryController_createCollection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/library/collections/{collectionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["LibraryController_removeCollection"];
        options?: never;
        head?: never;
        patch: operations["LibraryController_updateCollection"];
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/library/collections/{collectionId}/items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["LibraryController_addToCollection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/library/collections/{collectionId}/items/{itemId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["LibraryController_removeFromCollection"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/library/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["LibraryController_stats"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/library/metadata/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["LibraryController_searchMetadata"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/discover/taste": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DiscoveryController_taste"];
        put: operations["DiscoveryController_saveTaste"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/discover/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DiscoveryController_catalog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/discover/catalog/{itemId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DiscoveryController_item"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/discover/catalog/{itemId}/similar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DiscoveryController_similar"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/discover/recommendations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DiscoveryController_recommend"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/discover/recommendations/latest": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DiscoveryController_latest"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/discover/recommendations/{setId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DiscoveryController_set"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/discover/recommendations/{setId}/items/{itemId}/explain": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DiscoveryController_explain"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/discover/feedback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DiscoveryController_feedback"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/discover/saved": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DiscoveryController_saved"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/discover/model": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DiscoveryController_model"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/discover/evaluations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DiscoveryController_evaluations"];
        put?: never;
        post: operations["DiscoveryController_evaluate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/discover/evaluations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DiscoveryController_evaluation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/studio/capabilities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StudioController_capabilities"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/studio/compare": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StudioController_compare"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/studio/battles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StudioController_battles"];
        put?: never;
        post: operations["StudioController_createBattle"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/studio/battles/{battleId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StudioController_battle"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/studio/battles/{battleId}/vote": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StudioController_vote"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/studio/evaluations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StudioController_evaluations"];
        put?: never;
        post: operations["StudioController_createEvaluation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/studio/evaluations/{evaluationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StudioController_evaluation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/budgets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["BudgetsController_list"];
        put?: never;
        post: operations["BudgetsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspaceId}/budgets/{policyId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["BudgetsController_remove"];
        options?: never;
        head?: never;
        patch: operations["BudgetsController_update"];
        trace?: never;
    };
    "/api/admin/models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AdminModelsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/models/registry/diff": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AdminModelsController_diff"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/models/registry/sync": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AdminModelsController_sync"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/models/{modelId}": {
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
        patch: operations["AdminModelsController_patch"];
        trace?: never;
    };
    "/api/admin/models/{modelId}/prices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AdminModelsController_addPrice"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/costs/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AdminCostsController_overview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/costs/rollup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AdminCostsController_rollup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/costs/reconciliation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AdminCostsController_reconciliation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/costs/reconciliation/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AdminCostsController_importCsv"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/costs/reconciliation/fetch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AdminCostsController_fetchReport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/costs/infra": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AdminCostsController_infra"];
        put?: never;
        post: operations["AdminCostsController_addInfra"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/costs/infra/import-gcp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AdminCostsController_importGcp"];
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
        RegisterDto: {
            email: string;
            password: string;
            displayName: string;
        };
        LoginDto: {
            email: string;
            password: string;
        };
        UpdateMeDto: {
            displayName?: string;
            preferences?: Record<string, never>;
        };
        TokenDto: {
            token: string;
        };
        ForgotPasswordDto: {
            email: string;
        };
        ResetPasswordDto: {
            token: string;
            password: string;
        };
        CreateWorkspaceDto: {
            name: string;
        };
        RoleDto: {
            /** @enum {string} */
            role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
        };
        InviteDto: {
            email: string;
            /** @enum {string} */
            role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
        };
        AcceptDto: {
            token: string;
        };
        CreateProjectDto: {
            name: string;
            /** @enum {string} */
            kind: "KNOWLEDGE" | "WRITER" | "LIBRARY";
            description?: string;
        };
        UpdateProjectDto: {
            name?: string;
            description?: string;
            archived?: boolean;
        };
        CreateFolderDto: {
            name: string;
            parentId?: string;
        };
        UpdateFolderDto: {
            name?: string;
            parentId?: Record<string, never>;
        };
        CreateUploadDto: {
            projectId: string;
            folderId?: string;
            /** @description Upload a new version of an existing source */
            sourceId?: string;
            filename: string;
            sizeBytes: number;
        };
        CompleteUploadDto: {
            title?: string;
        };
        UpdateSourceDto: {
            title?: string;
            folderId?: Record<string, never>;
            tags?: string[];
        };
        BatchDto: {
            ids: string[];
            /** @enum {string} */
            action: "delete" | "move" | "reingest" | "restore";
            folderId?: Record<string, never>;
        };
        RunInputDto: {
            question?: string;
            action?: string;
            text?: string;
            params?: Record<string, never>;
        };
        RunScopeDto: {
            projectId?: string;
            sourceIds?: string[];
            sourceVersionIds?: string[];
        };
        RunSpecDto: {
            /** @enum {string} */
            graph: "grounded_qa" | "insight" | "multi_doc_compare" | "risk_contradiction" | "knowledge_map" | "writer_revision" | "continuity_check" | "dna_extraction" | "passage_explain" | "research_writing" | "rec_explain" | "answer_judge";
            threadId?: string;
            parentMessageId?: string;
            input: components["schemas"]["RunInputDto"];
            scope?: components["schemas"]["RunScopeDto"];
            modelPreference?: string;
            lab?: boolean;
            options?: Record<string, never>;
            /** @description Lab runs only: fallback models replacing the registry fallbacks */
            fallbackModels?: string[];
            /** @description Lab runs only: run a chat graph without creating a conversation thread */
            detached?: boolean;
        };
        ForkDto: {
            checkpointId?: string;
            modelPreference?: string;
            inputOverride?: Record<string, never>;
            options?: Record<string, never>;
        };
        ThreadScopeDto: {
            sourceVersionIds: string[];
        };
        UpdateThreadDto: {
            title?: string;
            archived?: boolean;
        };
        EstimateDto: {
            /** @example mock-grounded */
            modelConfigId: string;
            /** @default 1 */
            calls: number;
            /** @description Input tokens per call (including cached) */
            inputTokens: number;
            /** @description Of which served from the provider cache */
            cachedInputTokens?: number;
            outputTokens: number;
        };
        UpdateArtifactDto: {
            title?: string;
            archived?: boolean;
        };
        CreateNoteDto: {
            body: string;
            sourceId?: string;
            sourceVersionId?: string;
            quote?: string;
            /** @description Source anchor (page, textPosition, textQuote) */
            anchor?: Record<string, never>;
        };
        UpdateNoteDto: {
            body: string;
        };
        CreateManuscriptDto: {
            title: string;
            /** @description WRITER project; a new one is created when omitted */
            projectId?: string;
        };
        UpdateManuscriptDto: {
            title?: string;
            dailyGoal?: number;
            archived?: boolean;
        };
        CreateNodeDto: {
            /** @enum {string} */
            kind: "PART" | "CHAPTER" | "SCENE";
            title: string;
            parentId?: string;
            position?: number;
        };
        UpdateNodeDto: {
            title?: string;
            pov?: string;
            parentId?: Record<string, never> | null;
            position?: number;
        };
        SaveDocDto: {
            /** @description TipTap JSON document */
            content: Record<string, never>;
            /** @description Revision the edit is based on (optimistic concurrency) */
            revision: number;
            /** @enum {string} */
            action?: "accept" | "undo";
            suggestionId?: string;
            variant?: number;
        };
        RestoreDto: {
            /** @description Current revision (optimistic concurrency) */
            revision: number;
        };
        RequestSuggestionsDto: {
            /** @enum {string} */
            mode: "rewrite" | "expand" | "shorten" | "tone" | "dialogue" | "continue";
            blockIds?: string[];
            /** @description Batch mode: every non-empty paragraph in the scene */
            all?: boolean;
            tone?: string;
            instruction?: string;
        };
        UpdateSuggestionDto: {
            /**
             * @description Reject, or undo a rejection
             * @enum {string}
             */
            state: "REJECTED" | "PENDING";
        };
        CreateFactDto: {
            subject: string;
            /** @enum {string} */
            subjectKind?: "CHARACTER" | "PLACE" | "OBJECT" | "THEME" | "EVENT";
            predicate?: string;
            value?: string;
            statement?: string;
        };
        UpdateFactDto: {
            /** @enum {string} */
            status?: "CANON" | "RETIRED";
            statement?: string;
            value?: string;
            note?: string;
        };
        CreateLinkDto: {
            source: string;
            target: string;
            label: string;
        };
        UpdateLinkDto: {
            /** @enum {string} */
            status: "CANON" | "RETIRED";
        };
        ScenesDto: {
            /** @description Scenes to use; all scenes when omitted */
            nodeIds?: string[];
        };
        UpdateIssueDto: {
            /** @enum {string} */
            state: "OPEN" | "RESOLVED" | "DISMISSED";
        };
        CreateExcerptDto: {
            sourceId: string;
            sourceVersionId?: string;
            quote: string;
            /** @description Source anchor (page, textQuote, textPosition) */
            anchor?: Record<string, never>;
        };
        CreateResearchNoteDto: {
            title?: string;
            body?: string;
            excerptId?: string;
            nodeId?: string;
        };
        UpdateResearchNoteDto: {
            title?: string;
            body?: string;
        };
        BookDto: {
            title: string;
            subtitle?: string;
            authors?: string[];
            language?: string;
            publisher?: string;
            publishedYear?: number;
            isbn13?: string;
            description?: string;
            subjects?: string[];
            pageCount?: number;
            coverUrl?: string;
            /** @enum {string} */
            metadataSource?: "MANUAL" | "OPEN_LIBRARY" | "GOOGLE_BOOKS";
            externalIds?: Record<string, never>;
        };
        CreateItemDto: {
            /** @description An uploaded book file (EPUB or PDF) */
            sourceId?: string;
            /** @description Manual entry or a confirmed metadata result */
            book?: components["schemas"]["BookDto"];
            /** @enum {string} */
            status?: "TO_READ" | "READING" | "FINISHED" | "ABANDONED";
        };
        UpdateBookDto: {
            title?: string;
            subtitle?: string;
            authors?: string[];
            language?: string;
            publisher?: string;
            publishedYear?: number;
            isbn13?: string;
            description?: string;
            subjects?: string[];
            pageCount?: number;
            coverUrl?: string;
            /** @enum {string} */
            metadataSource?: "MANUAL" | "OPEN_LIBRARY" | "GOOGLE_BOOKS";
            externalIds?: Record<string, never>;
        };
        UpdateItemDto: {
            /** @enum {string} */
            status?: "TO_READ" | "READING" | "FINISHED" | "ABANDONED";
            /** @description 0 clears the rating */
            rating?: number;
            book?: components["schemas"]["UpdateBookDto"];
        };
        ProgressDto: {
            /** @description Reader Locator { href, type, title, locations { progression, totalProgression, position, cfi, page } } */
            locator: Record<string, never>;
            percent: number;
            /** @description Reading time since the last report (capped at one hour) */
            secondsDelta?: number;
        };
        CreateAnnotationDto: {
            /** @description Client-generated id; repeating a create with the same id is a no-op */
            id?: string;
            /** @enum {string} */
            kind: "HIGHLIGHT" | "NOTE";
            /** @enum {string} */
            color?: "amber" | "sage" | "rose" | "sky";
            locator: Record<string, never>;
            quote?: string;
            note?: string;
        };
        UpdateAnnotationDto: {
            /** @enum {string} */
            color?: "amber" | "sage" | "rose" | "sky";
            note?: string;
        };
        CreateBookmarkDto: {
            locator: Record<string, never>;
            label?: string;
        };
        ExplainDto: {
            /** @enum {string} */
            mode: "explain" | "define" | "summarize" | "context" | "ask";
            passage: string;
            question?: string;
            /** @description Where the passage is; it bounds what the model may see (spoiler guard) */
            locator: Record<string, never>;
        };
        ReaderExcerptDto: {
            quote: string;
            locator: Record<string, never>;
        };
        CollectionDto: {
            name: string;
            description?: string;
        };
        UpdateCollectionDto: {
            name?: string;
            description?: string;
        };
        CollectionItemDto: {
            itemId: string;
        };
        TasteDto: {
            genres?: string[];
            moods?: string[];
            themes?: string[];
            /** @description Catalog items picked as favourites */
            seedItemIds?: string[];
        };
        WeightsDto: {
            semantic?: number;
            tfidf?: number;
            theme?: number;
            preference?: number;
            /** @description Capped at 0.10 after normalisation */
            prior?: number;
        };
        LabDto: {
            weights?: components["schemas"]["WeightsDto"];
            /** @description MMR relevance/diversity trade-off */
            lambda?: number;
            perCreator?: number;
            balanceMedia?: boolean;
        };
        RecommendDto: {
            /** @description What the member is in the mood for, in their own words */
            query?: string;
            /** @enum {string} */
            kind?: "BOOK" | "FILM";
            genres?: string[];
            moods?: string[];
            k?: number;
            /** @description Recommendation Lab overrides; the set is logged as LAB and records no impressions */
            lab?: components["schemas"]["LabDto"];
        };
        FeedbackDto: {
            itemId: string;
            /** @enum {string} */
            action: "SAVE" | "UNSAVE" | "LIKE" | "DISLIKE" | "CLEAR_RATING" | "DISMISS" | "UNDISMISS" | "CLICK";
            setId?: string;
            position?: number;
            reason?: string;
        };
        EvaluateDto: {
            k?: number;
        };
        BattleDto: {
            /** @description Finished grounded_qa run whose packed passages are frozen for every contestant */
            runId: string;
            models: string[];
            /** @description Defaults to the source run question */
            question?: string;
        };
        VoteDto: {
            /** @enum {string} */
            winner: "A" | "B" | "C" | "D" | "TIE";
        };
        EvalScopeDto: {
            projectId?: string;
            sourceIds?: string[];
            sourceVersionIds?: string[];
        };
        RetrievalOptionsDto: {
            topK?: number;
            /** @enum {string} */
            fusion?: "rrf" | "dense" | "sparse";
            rerank?: boolean;
            /** @enum {string} */
            chunkLevel?: "auto" | "child";
            contextBudget?: number;
        };
        EvaluationDto: {
            /** @example qa-small */
            dataset: string;
            scope: components["schemas"]["EvalScopeDto"];
            modelPreference?: string;
            options?: components["schemas"]["RetrievalOptionsDto"];
            /** @description Opt-in: grade answer relevance with a judge model (extra billed calls) */
            judge?: boolean;
        };
        BudgetDto: {
            /** @enum {string} */
            scope: "WORKSPACE" | "PROJECT" | "USER";
            /** @description Project id (PROJECT) or member user id (USER) */
            scopeRefId?: string;
            /**
             * @default MONTHLY
             * @enum {string}
             */
            period: "DAILY" | "MONTHLY";
            /** @example 10.00 */
            limitAmount: string;
            /**
             * @description Hard limits reject runs that could exceed them; soft limits only alert
             * @default true
             */
            hard: boolean;
            /**
             * @default [
             *       75,
             *       90,
             *       100
             *     ]
             */
            alertThresholds: number[];
        };
        BudgetPatchDto: {
            limitAmount?: string;
            hard?: boolean;
            /** @enum {string} */
            period?: "DAILY" | "MONTHLY";
            alertThresholds?: number[];
        };
        ModelPatchDto: {
            /** @enum {string} */
            status?: "UNVERIFIED" | "VERIFIED" | "DISABLED";
            /** @description Make this the default chat model (clears the flag elsewhere) */
            isDefault?: boolean;
        };
        PriceDto: {
            /**
             * @default MTOK
             * @enum {string}
             */
            unit: "MTOK" | "CPU_HOUR";
            /**
             * @description USD per 1M input tokens, or per CPU-hour for CPU_HOUR
             * @example 0.40
             */
            inputPerMTok: string;
            /** @description USD per 1M output tokens (required for MTOK) */
            outputPerMTok?: string;
            cachedInputPerMTok?: string;
            reasoningPerMTok?: string;
            /** @description Fraction off for batch calls, 0–1 */
            batchDiscount?: string;
            /** @default USD */
            currency: string;
            /** @description ISO time; defaults to now */
            effectiveFrom?: string;
            /** @description Where the price was published (https), or demo:// for DEMO prices */
            sourceUrl: string;
            isDemo?: boolean;
        };
        RollupDto: {
            /** @default 2 */
            days: number;
        };
        CsvImportDto: {
            /** @example openai */
            provider: string;
            /** @description CSV with a date column and an amount column (optional currency) */
            csv: string;
        };
        FetchDto: {
            /** @enum {string} */
            provider: "openai";
            /** @default 7 */
            days: number;
        };
        InfraDto: {
            /** @example 2026-10-01 */
            day: string;
            /** @example Cloud Run */
            service: string;
            /** @example 1.25 */
            amount: string;
            /** @default USD */
            currency: string;
            note?: string;
            isDemo?: boolean;
        };
        GcpImportDto: {
            /** @default 7 */
            days: number;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    HealthController_live: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    HealthController_ready: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AuthController_csrf: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AuthController_register: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RegisterDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AuthController_login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AuthController_refresh: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AuthController_logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AuthController_me: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AuthController_updateMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateMeDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AuthController_verify: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TokenDto"];
            };
        };
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AuthController_resend: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AuthController_forgot: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ForgotPasswordDto"];
            };
        };
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AuthController_reset: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResetPasswordDto"];
            };
        };
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    WorkspacesController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    WorkspacesController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateWorkspaceDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    WorkspacesController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    WorkspacesController_rename: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateWorkspaceDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    WorkspacesController_members: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    WorkspacesController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                userId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    WorkspacesController_setRole: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                userId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RoleDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    WorkspacesController_invite: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InviteDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    WorkspacesController_accept: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AcceptDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    WorkspacesController_auditLog: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ProjectsController_list: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ProjectsController_create: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateProjectDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ProjectsController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                projectId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ProjectsController_trash: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                projectId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ProjectsController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                projectId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateProjectDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ProjectsController_restore: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                projectId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ProjectsController_trashList: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ProjectsController_folders: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                projectId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ProjectsController_createFolder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                projectId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateFolderDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ProjectsController_deleteFolder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                folderId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ProjectsController_updateFolder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                folderId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateFolderDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SourcesController_createUpload: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateUploadDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SourcesController_upload: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                uploadId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SourcesController_complete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                uploadId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CompleteUploadDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SourcesController_list: {
        parameters: {
            query?: {
                folderId?: string;
                q?: string;
                state?: string;
                type?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
                projectId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SourcesController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                sourceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SourcesController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                sourceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SourcesController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                sourceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateSourceDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SourcesController_restore: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                sourceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SourcesController_batch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BatchDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SourcesController_file: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                sourceId: string;
                versionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SourcesController_pages: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                sourceId: string;
                versionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SourcesController_diff: {
        parameters: {
            query?: {
                against?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
                sourceId: string;
                versionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SourcesController_chunks: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                sourceId: string;
                versionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SourcesController_reingest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                sourceId: string;
                versionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    RunsController_list: {
        parameters: {
            query?: {
                graph?: string;
                status?: string;
                lab?: string;
                limit?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    RunsController_create: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RunSpecDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    RunsController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    RunsController_cancel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    RunsController_receipt: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    RunsController_trace: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    RunsController_checkpoints: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    RunsController_checkpoint: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                runId: string;
                checkpointId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    RunsController_fork: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                runId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ForkDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    RunsController_budget: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    RunsController_graph: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SseController_runEvents: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SseController_workspaceEvents: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ThreadsController_list: {
        parameters: {
            query?: {
                sourceId?: string;
                projectId?: string;
                q?: string;
                archived?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ThreadsController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                threadId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ThreadsController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                threadId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ThreadsController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                threadId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateThreadDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ThreadsController_setScope: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                threadId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ThreadScopeDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    CostsController_summary: {
        parameters: {
            query?: {
                days?: string;
                model?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    CostsController_estimate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EstimateDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    CostsController_anomalies: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    CostsController_entries: {
        parameters: {
            query?: {
                limit?: string;
                runId?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    CostsController_csv: {
        parameters: {
            query?: {
                days?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ModelsController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    NotificationsController_list: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    NotificationsController_readAll: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    InsightsController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ArtifactsController_list: {
        parameters: {
            query?: {
                projectId?: string;
                sourceId?: string;
                kind?: string;
                q?: string;
                archived?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ArtifactsController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                artifactId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ArtifactsController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                artifactId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ArtifactsController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                artifactId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateArtifactDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    NotesController_list: {
        parameters: {
            query?: {
                sourceId?: string;
                projectId?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    NotesController_create: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateNoteDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    NotesController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                noteId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    NotesController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                noteId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateNoteDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SearchController_search: {
        parameters: {
            query?: {
                projectId?: string;
                semantic?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ManuscriptsController_list: {
        parameters: {
            query?: {
                projectId?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ManuscriptsController_create: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateManuscriptDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ManuscriptsController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ManuscriptsController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ManuscriptsController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateManuscriptDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ManuscriptsController_createNode: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateNodeDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ManuscriptsController_removeNode: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
                nodeId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ManuscriptsController_updateNode: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
                nodeId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateNodeDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ManuscriptsController_getDoc: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
                nodeId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ManuscriptsController_saveDoc: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
                nodeId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveDocDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ManuscriptsController_revisions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
                nodeId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ManuscriptsController_revision: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
                nodeId: string;
                revision: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ManuscriptsController_restore: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
                nodeId: string;
                revision: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RestoreDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ManuscriptsController_compiledView: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ManuscriptsController_export: {
        parameters: {
            query: {
                /** @description Export format */
                format: "md" | "docx";
            };
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SuggestionsController_list: {
        parameters: {
            query?: {
                nodeId?: string;
                state?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SuggestionsController_request: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
                nodeId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RequestSuggestionsDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SuggestionsController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                suggestionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateSuggestionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DnaController_dna: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DnaController_createFact: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateFactDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DnaController_updateFact: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
                factId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateFactDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DnaController_createLink: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateLinkDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DnaController_updateLink: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
                linkId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateLinkDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DnaController_extract: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ScenesDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DnaController_issues: {
        parameters: {
            query?: {
                state?: string;
                nodeId?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DnaController_check: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ScenesDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DnaController_updateIssue: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
                issueId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateIssueDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ResearchController_excerpts: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ResearchController_createExcerpt: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateExcerptDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ResearchController_removeExcerpt: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                excerptId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ResearchController_notes: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ResearchController_createNote: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateResearchNoteDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ResearchController_removeNote: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
                noteId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ResearchController_updateNote: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                manuscriptId: string;
                noteId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateResearchNoteDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    LibraryController_list: {
        parameters: {
            query?: {
                status?: string;
                collectionId?: string;
                q?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    LibraryController_create: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateItemDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    LibraryController_detail: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                itemId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    LibraryController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                itemId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    LibraryController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                itemId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateItemDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    LibraryController_progress: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                itemId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProgressDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    LibraryController_annotations: {
        parameters: {
            query?: {
                since?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
                itemId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    LibraryController_createAnnotation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                itemId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateAnnotationDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    LibraryController_removeAnnotation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                itemId: string;
                annotationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    LibraryController_updateAnnotation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                itemId: string;
                annotationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateAnnotationDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    LibraryController_bookmarks: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                itemId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    LibraryController_createBookmark: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                itemId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateBookmarkDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    LibraryController_removeBookmark: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                itemId: string;
                bookmarkId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    LibraryController_explain: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                itemId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExplainDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    LibraryController_excerpt: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                itemId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReaderExcerptDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    LibraryController_collections: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    LibraryController_createCollection: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CollectionDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    LibraryController_removeCollection: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                collectionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    LibraryController_updateCollection: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                collectionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateCollectionDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    LibraryController_addToCollection: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                collectionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CollectionItemDto"];
            };
        };
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    LibraryController_removeFromCollection: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                collectionId: string;
                itemId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    LibraryController_stats: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    LibraryController_searchMetadata: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DiscoveryController_taste: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DiscoveryController_saveTaste: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TasteDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DiscoveryController_catalog: {
        parameters: {
            query?: {
                q?: string;
                kind?: string;
                genre?: string;
                mood?: string;
                theme?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DiscoveryController_item: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                itemId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DiscoveryController_similar: {
        parameters: {
            query?: {
                otherKind?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
                itemId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DiscoveryController_recommend: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RecommendDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DiscoveryController_latest: {
        parameters: {
            query?: {
                mode?: string;
            };
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DiscoveryController_set: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                setId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DiscoveryController_explain: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                setId: string;
                itemId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DiscoveryController_feedback: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FeedbackDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DiscoveryController_saved: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DiscoveryController_model: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DiscoveryController_evaluations: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DiscoveryController_evaluate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EvaluateDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    DiscoveryController_evaluation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    StudioController_capabilities: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    StudioController_compare: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    StudioController_battles: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    StudioController_createBattle: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BattleDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    StudioController_battle: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                battleId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    StudioController_vote: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                battleId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VoteDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    StudioController_evaluations: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    StudioController_createEvaluation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EvaluationDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    StudioController_evaluation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                evaluationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    BudgetsController_list: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    BudgetsController_create: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BudgetDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    BudgetsController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                policyId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    BudgetsController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                policyId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BudgetPatchDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AdminModelsController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AdminModelsController_diff: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AdminModelsController_sync: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AdminModelsController_patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                modelId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ModelPatchDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AdminModelsController_addPrice: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                modelId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PriceDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AdminCostsController_overview: {
        parameters: {
            query?: {
                days?: string;
                model?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AdminCostsController_rollup: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RollupDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AdminCostsController_reconciliation: {
        parameters: {
            query?: {
                days?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AdminCostsController_importCsv: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CsvImportDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AdminCostsController_fetchReport: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FetchDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AdminCostsController_infra: {
        parameters: {
            query?: {
                days?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AdminCostsController_addInfra: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InfraDto"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AdminCostsController_importGcp: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GcpImportDto"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
}
