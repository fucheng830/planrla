import { Router } from "express";

import { projectsDb } from "@/modules/database/index.js";
import {
  AppError,
  asyncHandler,
  createApiSuccessResponse,
} from "@/shared/utils.js";

import {
  openFileAction,
  probeFileActions,
  type FileActionKind,
} from "./file-actions.service.js";

export function createFileActionsRouter(): Router {
  const router = Router();

  /** GET /api/file-actions/probe - which editors/terminals exist on this machine. */
  router.get(
    "/probe",
    asyncHandler(async (_req, res) => {
      res.json(createApiSuccessResponse(await probeFileActions()));
    }),
  );

  /**
   * POST /api/file-actions/open - run one file action for a project file.
   * Body: { projectId, path, action: editor|reveal|terminal, editorId? }.
   * The service enforces the project-root sandbox; this route only shapes I/O.
   */
  router.post(
    "/open",
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as {
        projectId?: unknown;
        path?: unknown;
        action?: unknown;
        editorId?: unknown;
      };
      if (typeof body.projectId !== "string" || typeof body.path !== "string") {
        throw new AppError("projectId and path are required", {
          code: "INVALID_BODY",
          statusCode: 400,
        });
      }
      if (
        body.action !== "editor" &&
        body.action !== "reveal" &&
        body.action !== "terminal"
      ) {
        throw new AppError("action must be editor | reveal | terminal", {
          code: "INVALID_BODY",
          statusCode: 400,
        });
      }
      const projectRoot = await projectsDb.getProjectPathById(body.projectId);
      if (!projectRoot) {
        throw new AppError("project not found", {
          code: "PROJECT_NOT_FOUND",
          statusCode: 404,
        });
      }
      await openFileAction({
        root: projectRoot,
        rawPath: body.path,
        action: body.action as FileActionKind,
        editorId: typeof body.editorId === "string" ? body.editorId : undefined,
      });
      res.json(createApiSuccessResponse({ launched: true }));
    }),
  );

  return router;
}
