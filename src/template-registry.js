// src/template-registry.js
// Registry of available templates. Loaded from disk at story-gen time
// (for system-prompt injection) and at page-render time (for template-
// config lookup). Each template's config.json declares selection_metadata
// (summary, max_narrative_chars, aesthetic_intent) that lets Sonnet pick
// layouts per scene, and full render config that the page-pipeline
// consumes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const TEMPLATES_DIR = path.join(PROJECT_ROOT, "templates");

/**
 * Load all templates from disk. Returns an array of template descriptors,
 * one per `templates/<id>/config.json` file found. Each descriptor has
 * the full config object plus a `configPath` field for downstream
 * resolution. Throws if a template's config.json is missing
 * selection_metadata (it's not registry-ready).
 */
export async function loadTemplateRegistry() {
  const entries = fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true });
  const registry = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const configPath = path.join(TEMPLATES_DIR, entry.name, "config.json");
    if (!fs.existsSync(configPath)) continue;
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    // Non-page templates (e.g. the cover template, kind: "cover") live in
    // templates/ but are NOT interior page layouts Sonnet selects among —
    // skip them before the selection_metadata check (covers legitimately
    // have no selection_metadata). Interior page templates omit `kind`
    // (implicitly "page") or set it to "page".
    if (config.kind && config.kind !== "page") continue;
    if (!config.selection_metadata) {
      throw new Error(
        `Template "${entry.name}" config.json is missing selection_metadata. ` +
        `Cannot be used in multi-template orchestration. Add summary + ` +
        `max_narrative_chars + aesthetic_intent fields.`
      );
    }
    // Deferred templates stay on disk (preserved for test scripts +
    // iteration-artifact reference) but are excluded from the registry —
    // Sonnet's system prompt + schema enum never see them, so they can't
    // be selected for a book. Set `deferred: true` at the top level of
    // config.json to opt out. See templates/prompt-4-iter-1/config.json
    // for an example (deferred 2026-05-20 after 5 failed iterations).
    if (config.deferred === true) continue;
    registry.push({ ...config, configPath });
  }
  return registry;
}

/**
 * Format the registry as a human-readable description for embedding in
 * Sonnet's system prompt. One line per template with id, summary,
 * intent tags, and max-narrative-chars.
 */
export function buildTemplateMetadataForPrompt(registry) {
  const lines = ["Available templates:"];
  for (const t of registry) {
    const maxChars = t.selection_metadata.max_narrative_chars === null
      ? "any length"
      : `${t.selection_metadata.max_narrative_chars} chars`;
    const intent = t.selection_metadata.aesthetic_intent.join(", ");
    lines.push(
      `- ${t.id}: ${t.selection_metadata.summary} Suitable for: ${intent}. Max narrative: ${maxChars}.`
    );
  }
  return lines.join("\n");
}

/**
 * Look up a template by ID. Throws if not found.
 */
export function findTemplate(registry, templateId) {
  const found = registry.find((t) => t.id === templateId);
  if (!found) {
    throw new Error(
      `Template "${templateId}" not in registry. Available: ${registry.map((t) => t.id).join(", ")}`
    );
  }
  return found;
}
