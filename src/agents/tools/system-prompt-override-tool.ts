/**
 * System Prompt Override Tool
 *
 * Allows agents to read and modify their system prompt configuration.
 * This enables self-modifying behavior where agents can adjust their own instructions.
 *
 * Two-tier system:
 * - SYSTEM_PROMPT_OVERRIDE.md: Human-controlled, can override any section
 * - .openclaw/prompt-experiments.md: Agent-controlled, safe sections only
 */

import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import {
  AGENT_EXPERIMENTS_FILENAME,
  AGENT_SAFE_SECTIONS,
  DEFAULT_SYSTEM_PROMPT_OVERRIDE_FILENAME,
  extractPromptSections,
  parseOverrideMarkdown,
  PROTECTED_SECTIONS,
  SYSTEM_PROMPT_LOG_FILENAME,
  writeAgentExperiments,
} from "../../agents/system-prompt-override.js";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveUserPath } from "../../utils.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult } from "./common.js";

const SystemPromptOverrideParamsSchema = Type.Object({
  content: Type.Optional(
    Type.String({
      description:
        "Markdown content for the override file. Use '# SectionName' headers to override specific sections.",
    }),
  ),
  delete: Type.Optional(
    Type.Boolean({
      description: "Set to true to delete the override file",
    }),
  ),
  append: Type.Optional(
    Type.Boolean({
      description: "If true, append to existing override instead of replacing (default: false)",
    }),
  ),
});

const SystemPromptExperimentsParamsSchema = Type.Object({
  content: Type.Optional(
    Type.String({
      description:
        "Markdown content for experiments. Only safe sections (prepend, append, tooling, skills, memory, etc.) are allowed.",
    }),
  ),
  delete: Type.Optional(
    Type.Boolean({
      description: "Set to true to delete the experiments file",
    }),
  ),
  append: Type.Optional(
    Type.Boolean({
      description: "If true, append to existing experiments instead of replacing (default: false)",
    }),
  ),
});

export function createSystemPromptOverrideTool(opts: {
  workspaceDir: string;
  config?: OpenClawConfig;
}): AnyAgentTool {
  const workspaceDir = resolveUserPath(opts.workspaceDir);

  return {
    label: "System Prompt Override",
    name: "system_prompt_override",
    description: `Read, write, or delete the system prompt override file in the workspace.

Actions:
- No parameters: Read current override and the last-built system prompt log
- content: Write/append to the override file
- delete: true: Remove the override file

The override file uses markdown headers to identify sections:
# safety
Custom safety instructions...

# prepend
Content before all sections...

# append  
Content after all sections...

Available sections: tooling, safety, openclawCli, skills, memory, workspace, docs, time, workspaceFiles, messaging, voice, reactions, heartbeats, runtime

Changes take effect on the next agent run. Check .openclaw/system-prompt-log.txt to see the result.`,
    parameters: SystemPromptOverrideParamsSchema,
    execute: async (_toolCallId, args) => {
      const params = args as { content?: string; delete?: boolean; append?: boolean };
      const overridePath = path.join(workspaceDir, DEFAULT_SYSTEM_PROMPT_OVERRIDE_FILENAME);
      const logPath = path.join(workspaceDir, SYSTEM_PROMPT_LOG_FILENAME);

      // Delete mode
      if (params.delete) {
        try {
          await fs.unlink(overridePath);
          return jsonResult({ success: true, action: "deleted", path: overridePath });
        } catch (err) {
          const code = (err as { code?: string })?.code;
          if (code === "ENOENT") {
            return jsonResult({
              success: true,
              action: "none",
              message: "No override file exists",
            });
          }
          throw err;
        }
      }

      // Write mode
      if (typeof params.content === "string") {
        let content = params.content;

        if (params.append) {
          try {
            const existing = await fs.readFile(overridePath, "utf-8");
            content = existing.trim() + "\n\n" + content.trim();
          } catch {
            // No existing file, just use new content
          }
        }

        await fs.writeFile(overridePath, content.trim() + "\n", "utf-8");

        // Parse and report what sections were affected
        const parsed = parseOverrideMarkdown(content);
        const sections = Object.keys(parsed.sections);

        return jsonResult({
          success: true,
          action: params.append ? "appended" : "written",
          path: overridePath,
          sectionsAffected: sections,
          hasPrepend: !!parsed.prepend,
          hasAppend: !!parsed.append,
          hint: "Changes take effect on the next run. Check .openclaw/system-prompt-log.txt to verify.",
        });
      }

      // Read mode (default)
      const result: {
        override?: {
          path: string;
          exists: boolean;
          content?: string;
          parsed?: {
            sections: string[];
            hasPrepend: boolean;
            hasAppend: boolean;
          };
        };
        experiments?: {
          path: string;
          exists: boolean;
          content?: string;
          parsed?: {
            sections: string[];
            hasPrepend: boolean;
            hasAppend: boolean;
          };
        };
        log?: {
          path: string;
          exists: boolean;
          sections?: Record<string, number>;
          generatedAt?: string;
          source?: string;
        };
      } = {};

      // Read override file
      try {
        const content = await fs.readFile(overridePath, "utf-8");
        const parsed = parseOverrideMarkdown(content);
        result.override = {
          path: overridePath,
          exists: true,
          content,
          parsed: {
            sections: Object.keys(parsed.sections),
            hasPrepend: !!parsed.prepend,
            hasAppend: !!parsed.append,
          },
        };
      } catch {
        result.override = { path: overridePath, exists: false };
      }

      // Read experiments file
      try {
        const experimentsPath = path.join(workspaceDir, AGENT_EXPERIMENTS_FILENAME);
        const content = await fs.readFile(experimentsPath, "utf-8");
        const parsed = parseOverrideMarkdown(content);
        result.experiments = {
          path: experimentsPath,
          exists: true,
          content,
          parsed: {
            sections: Object.keys(parsed.sections),
            hasPrepend: !!parsed.prepend,
            hasAppend: !!parsed.append,
          },
        };
      } catch {
        result.experiments = {
          path: path.join(workspaceDir, AGENT_EXPERIMENTS_FILENAME),
          exists: false,
        };
      }

      // Read log file
      try {
        const logContent = await fs.readFile(logPath, "utf-8");
        const sections = extractPromptSections(logContent);

        // Extract metadata from log
        const generatedMatch = logContent.match(/Generated:\s*(.+)/);
        const sourceMatch = logContent.match(/Source:\s*(\w+)/);

        const sectionSizes: Record<string, number> = {};
        for (const [name, content] of Object.entries(sections)) {
          sectionSizes[name] = content.length;
        }

        result.log = {
          path: logPath,
          exists: true,
          sections: sectionSizes,
          generatedAt: generatedMatch?.[1]?.trim(),
          source: sourceMatch?.[1]?.trim(),
        };
      } catch {
        result.log = { path: logPath, exists: false };
      }

      return jsonResult(result);
    },
  };
}

/**
 * Tool for agent-controlled prompt experiments.
 * Agents can modify safe sections without human approval.
 */
export function createSystemPromptExperimentsTool(opts: { workspaceDir: string }): AnyAgentTool {
  const workspaceDir = resolveUserPath(opts.workspaceDir);

  return {
    label: "System Prompt Experiments",
    name: "system_prompt_experiments",
    description: `Read or modify agent experiments file (.openclaw/prompt-experiments.md).

This file allows you to experiment with prompt modifications in SAFE sections only.
Protected sections (safety, messaging, reactions) require SYSTEM_PROMPT_OVERRIDE.md.

Actions:
- No parameters: Read current experiments and available safe sections
- content: Write/append to experiments (safe sections only)
- delete: true: Remove experiments file

Safe sections you CAN modify:
- prepend, append (identity and context)
- tooling, toolCallStyle (tool usage patterns)
- skills (skills documentation)
- memory (memory recall instructions)
- workspace, workspaceFiles (workspace context)
- heartbeats (heartbeat behavior)
- reasoningFormat (reasoning display)

Protected sections requiring human approval:
- safety, messaging, reactions, authorizedSenders, sandbox, etc.

Changes take effect on the next agent run.`,
    parameters: SystemPromptExperimentsParamsSchema,
    execute: async (_toolCallId, args) => {
      const params = args as { content?: string; delete?: boolean; append?: boolean };
      const experimentsPath = path.join(workspaceDir, AGENT_EXPERIMENTS_FILENAME);

      // Delete mode
      if (params.delete) {
        try {
          await fs.unlink(experimentsPath);
          return jsonResult({ success: true, action: "deleted", path: experimentsPath });
        } catch (err) {
          const code = (err as { code?: string })?.code;
          if (code === "ENOENT") {
            return jsonResult({
              success: true,
              action: "none",
              message: "No experiments file exists",
            });
          }
          throw err;
        }
      }

      // Write mode
      if (typeof params.content === "string") {
        let content = params.content;

        if (params.append) {
          try {
            const existing = await fs.readFile(experimentsPath, "utf-8");
            content = existing.trim() + "\n\n" + content.trim();
          } catch {
            // No existing file, just use new content
          }
        }

        const result = await writeAgentExperiments({
          workspaceDir,
          content,
        });

        if (!result.written) {
          return jsonResult({
            success: false,
            action: "rejected",
            rejectedSections: result.rejectedSections,
            message: `These sections are protected and require SYSTEM_PROMPT_OVERRIDE.md: ${result.rejectedSections.join(", ")}`,
            safeSections: Array.from(AGENT_SAFE_SECTIONS),
            protectedSections: Array.from(PROTECTED_SECTIONS),
          });
        }

        const parsed = parseOverrideMarkdown(content);
        return jsonResult({
          success: true,
          action: params.append ? "appended" : "written",
          path: experimentsPath,
          sectionsAffected: Object.keys(parsed.sections),
          hasPrepend: !!parsed.prepend,
          hasAppend: !!parsed.append,
          hint: "Changes take effect on the next run. Use system_prompt_override to verify.",
        });
      }

      // Read mode (default)
      const result: {
        experiments?: {
          path: string;
          exists: boolean;
          content?: string;
          parsed?: {
            sections: string[];
            hasPrepend: boolean;
            hasAppend: boolean;
          };
        };
        safeSections: string[];
        protectedSections: string[];
      } = {
        safeSections: Array.from(AGENT_SAFE_SECTIONS).toSorted(),
        protectedSections: Array.from(PROTECTED_SECTIONS).toSorted(),
      };

      try {
        const content = await fs.readFile(experimentsPath, "utf-8");
        const parsed = parseOverrideMarkdown(content);
        result.experiments = {
          path: experimentsPath,
          exists: true,
          content,
          parsed: {
            sections: Object.keys(parsed.sections),
            hasPrepend: !!parsed.prepend,
            hasAppend: !!parsed.append,
          },
        };
      } catch {
        result.experiments = {
          path: experimentsPath,
          exists: false,
        };
      }

      return jsonResult(result);
    },
  };
}

const SystemPromptPatchParamsSchema = Type.Object({
  section: Type.String({
    description: "Section name to patch (e.g., 'safety', 'memoryRecall')",
  }),
  content: Type.String({
    description: "New content for the section (without the ## header)",
  }),
  dryRun: Type.Optional(
    Type.Boolean({
      description: "If true, show what would change without modifying files",
    }),
  ),
});

/**
 * Create a tool for patching the system prompt source code.
 * This is for advanced users who own their OpenClaw fork.
 */
export function createSystemPromptPatchTool(opts: {
  workspaceDir: string;
  openclawSourceDir?: string;
}): AnyAgentTool {
  return {
    label: "System Prompt Patch",
    name: "system_prompt_patch",
    description: `Patch the OpenClaw system prompt source code directly.

This tool modifies the base system prompt in the OpenClaw source tree.
Use this when you need to change defaults that apply before override processing.

WARNING: This modifies source code. You need to rebuild OpenClaw after changes.

Sections that can be patched:
- safety: The safety guidelines section
- memoryRecall: Memory recall instructions
- heartbeats: Heartbeat behavior
- messaging: Messaging channel guidance

Provide the section name and new content. The tool will find and replace
the section in the source file using the ## header markers.`,
    parameters: SystemPromptPatchParamsSchema,
    execute: async (_toolCallId, args) => {
      const params = args as { section: string; content: string; dryRun?: boolean };
      // Find the source file
      const possiblePaths = [
        opts.openclawSourceDir,
        "/home/andrew/openclaw",
        path.join(resolveUserPath(opts.workspaceDir), "openclaw"),
      ].filter(Boolean) as string[];

      let sourceDir: string | null = null;
      for (const p of possiblePaths) {
        try {
          const stat = await fs.stat(path.join(p, "src", "agents", "system-prompt.ts"));
          if (stat.isFile()) {
            sourceDir = p;
            break;
          }
        } catch {
          // Continue checking other paths
        }
      }

      if (!sourceDir) {
        return jsonResult({
          success: false,
          error: "Could not find OpenClaw source directory",
          searched: possiblePaths,
          hint: "Set openclawSourceDir in the tool options or ensure the source is at a standard location",
        });
      }

      const sourcePath = path.join(sourceDir, "src", "agents", "system-prompt.ts");
      const sourceContent = await fs.readFile(sourcePath, "utf-8");

      // Find the section in source
      const sectionPattern = new RegExp(
        `^(##\\s+${params.section}[ \\t]*$)([\\s\\S]*?)(?=^##\\s+|\\Z)`,
        "m",
      );
      const match = sourceContent.match(sectionPattern);

      if (!match) {
        // List available sections
        const sections = [...sourceContent.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
        return jsonResult({
          success: false,
          error: `Section '${params.section}' not found in source`,
          availableSections: sections,
          sourcePath,
        });
      }

      const header = match[1];
      const oldContent = match[2].trim();
      const newSection = `${header}\n${params.content.trim()}\n`;

      if (params.dryRun) {
        return jsonResult({
          success: true,
          action: "dry-run",
          sourcePath,
          section: params.section,
          oldContent,
          newContent: params.content.trim(),
          oldLength: oldContent.length,
          newLength: params.content.trim().length,
        });
      }

      // Apply the patch
      const patchedContent = sourceContent.replace(sectionPattern, newSection);
      await fs.writeFile(sourcePath, patchedContent, "utf-8");

      return jsonResult({
        success: true,
        action: "patched",
        sourcePath,
        section: params.section,
        oldLength: oldContent.length,
        newLength: params.content.trim().length,
        hint: "Run 'cd openclaw && npm run build' to rebuild, then restart OpenClaw",
      });
    },
  };
}
