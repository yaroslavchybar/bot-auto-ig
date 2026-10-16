import { AsyncLocalStorage } from 'node:async_hooks'
import {
  aiStepSettings,
  profileScreeningSettings,
  validateAiSettings,
  type AiSettings,
  type AiStep,
  type ProfileScreeningSettings,
} from '../shared/aiSettings.js'

const settings = new AsyncLocalStorage<AiSettings>()

/** Keep each automation's choices isolated while several profile sessions run together. */
export function withAiSettings<T>(
  value: AiSettings | undefined,
  run: () => Promise<T>,
): Promise<T> {
  validateAiSettings(value)
  return settings.run(value ?? {}, run)
}

export const currentAiStep = (step: AiStep) => aiStepSettings(step, settings.getStore())

/** Prompts and fallback order for the running automation, defaults when it saved none. */
export const currentScreeningSettings = (): ProfileScreeningSettings =>
  profileScreeningSettings(settings.getStore())
