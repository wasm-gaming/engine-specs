// Runtime validation of an EngineManifest against the contract.
// Engine CIs can run this to fail a build that drifts from the spec; hosts can run
// it on manifests fetched from Releases before trusting them.

import { z } from 'zod';
import type { EngineManifest } from './manifest.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const AssetValidationSchema = z.object({
  bytes: z.int().nonnegative().optional(),
  sha1: z.string().optional(),
}).strict();

const AssetSpecSchema = z.object({
  key: z.string().min(1),
  mountPath: z.string().regex(/^\//),
  required: z.boolean(),
  accept: z.array(z.string()).optional(),
  validate: AssetValidationSchema.optional(),
  description: z.string().optional(),
}).strict();

const InputSchema = z.union([
  z.string(),
  z.record(z.string(), z.string()),
]);

const VideoSpecSchema = z.object({
  baseWidth: z.int().positive(),
  baseHeight: z.int().positive(),
  aspect: z.string().optional(),
}).strict();

const EngineArtifactsSchema = z.object({
  wasm: z.string(),
  js: z.string(),
  data: z.string().optional(),
}).strict();

const EngineCapabilitiesSchema = z.object({
  saveStates: z.boolean().optional(),
  sram: z.boolean().optional(),
  coreSelectable: z.boolean().optional(),
}).strict();

const EngineManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  artifacts: EngineArtifactsSchema,
  assets: z.array(AssetSpecSchema),
  input: InputSchema,
  video: VideoSpecSchema,
  options: z.record(z.string(), z.unknown()).optional(),
  capabilities: EngineCapabilitiesSchema,
}).strict();

function formatIssuePath(path: PropertyKey[]): string {
  if (path.length === 0) return 'manifest';

  let out = 'manifest';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else if (typeof part === 'string') out += `.${part}`;
    else out += '.[symbol]';
  }
  return out;
}

/** Validate an unknown value as an EngineManifest. Never throws. */
export function validateManifest(input: unknown): ValidationResult {
  const result = EngineManifestSchema.safeParse(input);
  if (result.success) return { valid: true, errors: [] };

  const errors = result.error.issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`);
  return { valid: false, errors };
}

/** Validate and throw on failure. Returns the value narrowed to EngineManifest. */
export function assertManifest(input: unknown): EngineManifest {
  const result = EngineManifestSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`);
    throw new Error(`Invalid EngineManifest:\n- ${errors.join('\n- ')}`);
  }
  return result.data as EngineManifest;
}
