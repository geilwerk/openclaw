/**
 * System prompt override configuration.
 *
 * Allows fine-grained customization of the base system prompt without
 * modifying source code. Overrides can be applied via:
 * - Config file (SYSTEM_PROMPT_OVERRIDE.md)
 * - Plugin hook (modify_system_prompt_sections)
 * - Agent tool (system_prompt tool with read/write)
 */

/**
 * Named sections in the system prompt that can be overridden.
 * Each section maps to a specific part of buildAgentSystemPrompt().
 */
export type SystemPromptSectionName =
  | "tooling"
  | "toolCallStyle"
  | "safety"
  | "openclawCli"
  | "skills"
  | "memory"
  | "selfUpdate"
  | "modelAliases"
  | "workspace"
  | "docs"
  | "sandbox"
  | "authorizedSenders"
  | "time"
  | "workspaceFiles"
  | "replyTags"
  | "messaging"
  | "voice"
  | "groupChatContext"
  | "reactions"
  | "reasoningFormat"
  | "silentReplies"
  | "heartbeats"
  | "runtime";

/**
 * Override modes for each section.
 * - "replace": Completely replace the section content
 * - "prepend": Add content before the section
 * - "append": Add content after the section
 * - "omit": Remove the section entirely
 */
export type SystemPromptSectionOverride =
  | string // shorthand for replace
  | {
      replace?: string;
      prepend?: string;
      append?: string;
      omit?: boolean;
    };

/**
 * Full system prompt override configuration.
 */
export type SystemPromptOverrideConfig = {
  /**
   * Per-section overrides. Each key is a section name.
   * Values can be a string (replace) or an object with prepend/append/replace.
   */
  sections?: Record<string, SystemPromptSectionOverride>;

  /**
   * Content to prepend to the entire system prompt (before all sections).
   */
  prepend?: string;

  /**
   * Content to append to the entire system prompt (after all sections).
   */
  append?: string;

  /**
   * Path to a markdown file containing override content.
   * If set, the file is loaded and parsed for section overrides.
   * Relative paths resolve from the workspace directory.
   */
  file?: string;

  /**
   * Enable logging of the built system prompt to a file.
   * The log file will be written to the workspace directory.
   */
  logToFile?: boolean | string; // true = default path, string = custom path
};

/**
 * Resolved system prompt override (after loading from file/config).
 */
export type ResolvedSystemPromptOverride = {
  sections: Record<string, { prepend?: string; replace?: string; append?: string; omit?: boolean }>;
  prepend?: string;
  append?: string;
};

/**
 * Result of building a system prompt with overrides applied.
 */
export type SystemPromptBuildResult = {
  prompt: string;
  sections: Record<string, { original: string; final: string; overridden: boolean }>;
  source: "default" | "file" | "hook" | "mixed";
  loggedTo?: string;
};
