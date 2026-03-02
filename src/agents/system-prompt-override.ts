/**
 * System Prompt Override System
 *
 * Allows fine-grained customization of the base system prompt without modifying source code.
 * Supports:
 * - Config file: SYSTEM_PROMPT_OVERRIDE.md in workspace (human-controlled)
 * - Agent experiments: .openclaw/prompt-experiments.md (agent-controlled, safe sections only)
 * - Plugin hook: modify_system_prompt_sections
 * - Agent tool: read/write system prompt configuration
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import type { ResolvedSystemPromptOverride } from "../config/types.system-prompt.js";
import { resolveUserPath } from "../utils.js";

export const DEFAULT_SYSTEM_PROMPT_OVERRIDE_FILENAME = "SYSTEM_PROMPT_OVERRIDE.md";
export const AGENT_EXPERIMENTS_FILENAME = ".openclaw/prompt-experiments.md";
export const SYSTEM_PROMPT_LOG_FILENAME = ".openclaw/system-prompt-log.txt";

/**
 * Sections that agents are allowed to modify in prompt-experiments.md.
 * Protected sections require SYSTEM_PROMPT_OVERRIDE.md (human approval).
 */
export const AGENT_SAFE_SECTIONS = new Set([
  "prepend",
  "append",
  "tooling",
  "toolCallStyle",
  "skills",
  "memory",
  "workspace",
  "workspaceFiles",
  "heartbeats",
  "reasoningFormat",
  "selfUpdate",
  "modelAliases",
  "docs",
  "time",
  "runtime",
]);

export const PROTECTED_SECTIONS = new Set([
  "safety",
  "messaging",
  "reactions",
  "authorizedSenders",
  "sandbox",
  "groupChatContext",
  "voice",
  "replyTags",
  "silentReplies",
  "openclawCli",
]);

/**
 * Parse a markdown file into section overrides.
 */
export function parseOverrideMarkdown(content: string): ResolvedSystemPromptOverride {
  const sections: ResolvedSystemPromptOverride["sections"] = {};
  let prepend: string | undefined;
  let append: string | undefined;

  const lines = content.split("\n");
  let currentSection: string | null = null;
  let currentContent: string[] = [];

  const flushSection = () => {
    if (currentSection && currentContent.length > 0) {
      const trimmedContent = currentContent.join("\n").trim();
      if (currentSection === "prepend") {
        prepend = trimmedContent;
      } else if (currentSection === "append") {
        append = trimmedContent;
      } else {
        sections[currentSection] = { replace: trimmedContent };
      }
    }
    currentContent = [];
  };

  for (const line of lines) {
    const headerMatch = line.match(/^#\s+(.+)$/);
    if (headerMatch) {
      flushSection();
      currentSection = normalizeSectionName(headerMatch[1].trim());
    } else if (currentSection) {
      currentContent.push(line);
    }
  }
  flushSection();

  return { sections, prepend, append };
}

/**
 * Normalize section names to match the expected format.
 */
function normalizeSectionName(name: string): string {
  const aliases: Record<string, string> = {
    tooling: "tooling",
    tools: "tooling",
    tool: "tooling",
    toolcallstyle: "toolCallStyle",
    safety: "safety",
    openclaw: "openclawCli",
    openclawcli: "openclawCli",
    cli: "openclawCli",
    skills: "skills",
    skill: "skills",
    memory: "memory",
    selfupdate: "selfUpdate",
    self: "selfUpdate",
    update: "selfUpdate",
    modelaliases: "modelAliases",
    aliases: "modelAliases",
    workspace: "workspace",
    docs: "docs",
    documentation: "docs",
    sandbox: "sandbox",
    authorizedsenders: "authorizedSenders",
    senders: "authorizedSenders",
    time: "time",
    workspacefiles: "workspaceFiles",
    files: "workspaceFiles",
    context: "workspaceFiles",
    replytags: "replyTags",
    messaging: "messaging",
    voice: "voice",
    groupchatcontext: "groupChatContext",
    groupchat: "groupChatContext",
    reactions: "reactions",
    reasoningformat: "reasoningFormat",
    reasoning: "reasoningFormat",
    silentreplies: "silentReplies",
    silent: "silentReplies",
    heartbeats: "heartbeats",
    heartbeat: "heartbeats",
    runtime: "runtime",
  };

  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)/g, (_, char) => char.toUpperCase())
    .replace(/[^a-z0-9]/g, "");

  return aliases[normalized] ?? normalized;
}

/**
 * Load system prompt override from workspace file.
 */
export async function loadSystemPromptOverride(params: {
  workspaceDir: string;
  config?: OpenClawConfig;
}): Promise<ResolvedSystemPromptOverride | null> {
  const workspaceDir = resolveUserPath(params.workspaceDir);
  const overridePath = path.join(workspaceDir, DEFAULT_SYSTEM_PROMPT_OVERRIDE_FILENAME);

  try {
    const stat = await fs.stat(overridePath);
    if (!stat.isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  const content = await fs.readFile(overridePath, "utf-8");
  return parseOverrideMarkdown(content);
}

/**
 * Load agent experiments file (safe sections only).
 * Returns null if file doesn't exist or is empty.
 */
export async function loadAgentExperiments(params: {
  workspaceDir: string;
}): Promise<ResolvedSystemPromptOverride | null> {
  const workspaceDir = resolveUserPath(params.workspaceDir);
  const experimentsPath = path.join(workspaceDir, AGENT_EXPERIMENTS_FILENAME);

  try {
    const stat = await fs.stat(experimentsPath);
    if (!stat.isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  const content = await fs.readFile(experimentsPath, "utf-8");
  const parsed = parseOverrideMarkdown(content);

  // Filter to only agent-safe sections
  const filteredSections: ResolvedSystemPromptOverride["sections"] = {};
  for (const [section, override] of Object.entries(parsed.sections)) {
    if (AGENT_SAFE_SECTIONS.has(section)) {
      filteredSections[section] = override;
    }
  }

  return {
    sections: filteredSections,
    prepend: AGENT_SAFE_SECTIONS.has("prepend") ? parsed.prepend : undefined,
    append: AGENT_SAFE_SECTIONS.has("append") ? parsed.append : undefined,
  };
}

/**
 * Extract sections from a prompt using ## headers.
 */
export function extractPromptSections(prompt: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = prompt.split("\n");
  let currentSection: string | null = null;
  let currentContent: string[] = [];

  const flushSection = () => {
    if (currentSection && currentContent.length > 0) {
      sections[currentSection] = currentContent.join("\n").trim();
    }
    currentContent = [];
  };

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+(.+)$/);
    if (headerMatch) {
      flushSection();
      currentSection = normalizeSectionName(headerMatch[1].trim());
    } else if (currentSection) {
      currentContent.push(line);
    }
  }
  flushSection();

  return sections;
}

/**
 * Apply section overrides to a prompt.
 */
export function applyPromptOverrides(
  prompt: string,
  override: ResolvedSystemPromptOverride,
): string {
  const lines = prompt.split("\n");
  const result: string[] = [];

  // Track which sections we've modified
  const modifiedSections = new Set<string>();

  // Find the first section header position
  let firstSectionIndex = lines.findIndex((line) => line.match(/^##\s+/));
  if (firstSectionIndex === -1) {
    firstSectionIndex = lines.length;
  }

  // Add prepend content before first section
  if (override.prepend?.trim()) {
    result.push(override.prepend.trim(), "");
  }

  // Process the prompt line by line
  let currentSection: string | null = null;
  let skippingSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = line.match(/^##\s+(.+)$/);

    if (headerMatch) {
      // New section
      currentSection = normalizeSectionName(headerMatch[1].trim());
      const sectionOverride = override.sections[currentSection];

      if (sectionOverride?.omit) {
        skippingSection = true;
        modifiedSections.add(currentSection);
        continue;
      }

      skippingSection = false;

      if (sectionOverride?.replace) {
        // Replace section content
        result.push(line);
        result.push(sectionOverride.replace);
        modifiedSections.add(currentSection);
        // Skip original section content
        while (i + 1 < lines.length && !lines[i + 1].match(/^##\s+/)) {
          i++;
        }
        continue;
      }

      if (sectionOverride?.prepend) {
        result.push(line);
        result.push(sectionOverride.prepend);
        modifiedSections.add(currentSection);
        continue;
      }

      result.push(line);
    } else if (skippingSection) {
      // Skip this line (section marked for omission)
      continue;
    } else if (currentSection) {
      const sectionOverride = override.sections[currentSection];

      // Check if this is the last line of the section (next is header or end)
      const isLastInSection =
        i + 1 >= lines.length ||
        lines[i + 1].match(/^##\s+/) ||
        (lines[i + 1].trim() === "" && i + 2 < lines.length && lines[i + 2].match(/^##\s+/));

      result.push(line);

      if (isLastInSection && sectionOverride?.append && !modifiedSections.has(currentSection)) {
        result.push(sectionOverride.append);
        modifiedSections.add(currentSection);
      }
    } else {
      result.push(line);
    }
  }

  // Add append content
  if (override.append?.trim()) {
    result.push("", override.append.trim());
  }

  return result.join("\n");
}

/**
 * Log the built system prompt to a file for inspection.
 */
export async function logSystemPrompt(params: {
  prompt: string;
  workspaceDir: string;
  source: "default" | "file" | "hook" | "agent" | "mixed";
}): Promise<string | undefined> {
  const logDir = path.join(resolveUserPath(params.workspaceDir), ".openclaw");
  const logPath = path.join(logDir, "system-prompt-log.txt");

  try {
    await fs.mkdir(logDir, { recursive: true });

    const timestamp = new Date().toISOString();
    const sections = extractPromptSections(params.prompt);

    const logContent = [
      `# System Prompt Log`,
      `Generated: ${timestamp}`,
      `Source: ${params.source}`,
      ``,
      `## Section Summary`,
      ...Object.entries(sections).map(
        ([name, sectionContent]) => `- ${name}: ${sectionContent.length} chars`,
      ),
      ``,
      `## Full Prompt (${params.prompt.length} chars)`,
      ``,
      params.prompt,
    ].join("\n");

    await fs.writeFile(logPath, logContent, "utf-8");
    return logPath;
  } catch {
    return undefined;
  }
}

/**
 * Write a new system prompt override file.
 */
export async function writeSystemPromptOverride(params: {
  workspaceDir: string;
  content: string;
}): Promise<void> {
  const workspaceDir = resolveUserPath(params.workspaceDir);
  const overridePath = path.join(workspaceDir, DEFAULT_SYSTEM_PROMPT_OVERRIDE_FILENAME);
  await fs.writeFile(overridePath, params.content, "utf-8");
}

/**
 * Write agent experiments file (safe sections only).
 * Returns list of protected sections that were rejected.
 */
export async function writeAgentExperiments(params: {
  workspaceDir: string;
  content: string;
}): Promise<{ written: boolean; rejectedSections: string[] }> {
  const workspaceDir = resolveUserPath(params.workspaceDir);
  const experimentsPath = path.join(workspaceDir, AGENT_EXPERIMENTS_FILENAME);
  const parsed = parseOverrideMarkdown(params.content);

  // Check for protected sections
  const rejectedSections: string[] = [];
  for (const section of Object.keys(parsed.sections)) {
    if (PROTECTED_SECTIONS.has(section)) {
      rejectedSections.push(section);
    }
  }
  if (rejectedSections.length > 0) {
    return { written: false, rejectedSections };
  }

  // Ensure .openclaw directory exists
  await fs.mkdir(path.join(workspaceDir, ".openclaw"), { recursive: true });
  await fs.writeFile(experimentsPath, params.content, "utf-8");
  return { written: true, rejectedSections: [] };
}

/**
 * Create a template override file for users to customize.
 */
export function createOverrideTemplate(): string {
  return `# System Prompt Override

This file allows you to customize the base system prompt without modifying source code.
Edit this file to override specific sections. Delete or rename this file to revert to defaults.

## Usage

Use markdown headers to identify which section to override:

\`\`\`markdown
# SectionName
Your replacement content here...

# AnotherSection
More replacement content...

# prepend
Content to add before all sections...

# append
Content to add after all sections...
\`\`\`

## Available Sections

- **tooling**: Tool descriptions and availability
- **safety**: Safety guidelines
- **openclawCli**: CLI quick reference
- **skills**: Skills documentation
- **memory**: Memory recall instructions
- **workspace**: Workspace context
- **docs**: OpenClaw documentation path
- **time**: Timezone and time format
- **workspaceFiles**: Injected project context files
- **messaging**: Messaging channel guidance
- **voice**: TTS voice settings
- **reactions**: Reaction guidance (for supported channels)
- **silentReplies**: Silent reply rules
- **heartbeats**: Heartbeat behavior
- **runtime**: Runtime information (host, os, model)

## Special Sections

- **prepend**: Add content before all other sections
- **append**: Add content after all other sections

## Example

\`\`\`markdown
# safety
Custom safety instructions here...

# prepend
You are running in a specialized environment with these additional constraints:
- Constraint 1
- Constraint 2

# append
Remember to be concise and helpful.
\`\`\`

## Omitting Sections

To remove a section entirely:

\`\`\`markdown
# silentReplies
omit
\`\`\`
`;
}

/**
 * Create a template for agent experiments (safe sections only).
 */
export function createExperimentsTemplate(): string {
  return `# Prompt Experiments

This file allows agents to experiment with prompt modifications in safe sections.
Protected sections (safety, messaging, reactions) cannot be modified here.

## Safe Sections

The following sections can be modified in this file:
- prepend, append (identity and context)
- tooling, toolCallStyle (tool usage patterns)
- skills (skills documentation)
- memory (memory recall instructions)
- workspace, workspaceFiles (workspace context)
- heartbeats (heartbeat behavior)
- reasoningFormat (reasoning display)
- selfUpdate, modelAliases, docs, time, runtime

## Protected Sections

These sections require SYSTEM_PROMPT_OVERRIDE.md (human approval):
- safety (operational constraints)
- messaging (communication rules)
- reactions (reaction behavior)
- authorizedSenders, sandbox, groupChatContext, voice, replyTags, silentReplies, openclawCli

## Example

\`\`\`markdown
# prepend
You are Merlin, an expert AI agent optimizer...

# toolCallStyle
When using tools, prefer batched operations...

# append
Remember to document your changes in MEMORY.md.
\`\`\`
`;
}
