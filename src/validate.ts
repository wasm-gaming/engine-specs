// Zero-dependency runtime validation of an EngineManifest against the contract.
// Engine CIs can run this to fail a build that drifts from the spec; hosts can run
// it on manifests fetched from Releases before trusting them.

import type { EngineManifest } from './manifest.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Validate an unknown value as an EngineManifest. Never throws. */
export function validateManifest(input: unknown): ValidationResult {
  const errors: string[] = [];
  const push = (msg: string) => errors.push(msg);

  if (!isObject(input)) {
    return { valid: false, errors: ['manifest must be an object'] };
  }
  const m = input;

  if (typeof m.id !== 'string' || m.id.length === 0) push('id must be a non-empty string');
  if (typeof m.version !== 'string' || m.version.length === 0) push('version must be a non-empty string');
  if (m.name !== undefined && typeof m.name !== 'string') push('name must be a string');
  if (m.description !== undefined && typeof m.description !== 'string') push('description must be a string');

  // artifacts
  if (!isObject(m.artifacts)) {
    push('artifacts must be an object');
  } else {
    if (typeof m.artifacts.wasm !== 'string') push('artifacts.wasm must be a string');
    if (typeof m.artifacts.js !== 'string') push('artifacts.js must be a string');
    if (m.artifacts.data !== undefined && typeof m.artifacts.data !== 'string') {
      push('artifacts.data must be a string when present');
    }
  }

  // assets
  if (!Array.isArray(m.assets)) {
    push('assets must be an array (may be empty)');
  } else {
    const keys = new Set<string>();
    m.assets.forEach((a, i) => {
      const at = `assets[${i}]`;
      if (!isObject(a)) { push(`${at} must be an object`); return; }
      if (typeof a.key !== 'string' || a.key.length === 0) push(`${at}.key must be a non-empty string`);
      else if (keys.has(a.key)) push(`${at}.key "${a.key}" is duplicated`);
      else keys.add(a.key);
      if (typeof a.mountPath !== 'string' || !a.mountPath.startsWith('/')) {
        push(`${at}.mountPath must be an absolute path starting with "/"`);
      }
      if (typeof a.required !== 'boolean') push(`${at}.required must be a boolean`);
      if (a.accept !== undefined && !(Array.isArray(a.accept) && a.accept.every((x) => typeof x === 'string'))) {
        push(`${at}.accept must be an array of strings`);
      }
      if (a.validate !== undefined) {
        if (!isObject(a.validate)) push(`${at}.validate must be an object`);
        else {
          if (a.validate.bytes !== undefined && typeof a.validate.bytes !== 'number') push(`${at}.validate.bytes must be a number`);
          if (a.validate.sha1 !== undefined && typeof a.validate.sha1 !== 'string') push(`${at}.validate.sha1 must be a string`);
        }
      }
    });
  }

  // input
  if (!(typeof m.input === 'string' || isObject(m.input))) {
    push('input must be a preset string or a key-map object');
  }

  // video
  if (!isObject(m.video)) {
    push('video must be an object');
  } else {
    if (typeof m.video.baseWidth !== 'number' || m.video.baseWidth <= 0) push('video.baseWidth must be a positive number');
    if (typeof m.video.baseHeight !== 'number' || m.video.baseHeight <= 0) push('video.baseHeight must be a positive number');
    if (m.video.aspect !== undefined && typeof m.video.aspect !== 'string') push('video.aspect must be a string');
  }

  // options
  if (m.options !== undefined && !isObject(m.options)) push('options must be a JSON Schema object when present');

  // capabilities
  if (!isObject(m.capabilities)) {
    push('capabilities must be an object');
  } else {
    for (const k of ['saveStates', 'sram', 'coreSelectable'] as const) {
      if (m.capabilities[k] !== undefined && typeof m.capabilities[k] !== 'boolean') {
        push(`capabilities.${k} must be a boolean when present`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Validate and throw on failure. Returns the value narrowed to EngineManifest. */
export function assertManifest(input: unknown): EngineManifest {
  const { valid, errors } = validateManifest(input);
  if (!valid) throw new Error(`Invalid EngineManifest:\n- ${errors.join('\n- ')}`);
  return input as EngineManifest;
}
