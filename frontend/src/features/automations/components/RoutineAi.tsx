import { useId, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Field } from './RoutineFields'
import { cn } from '@/lib/utils'
import {
  aiStepSettings,
  MAX_AI_PROMPT_LENGTH,
  DECISION_MODELS,
  SCREENING_CHOICES,
  profileScreeningSettings,
  type AiSettings,
  type AiStep,
  type ProfileScreeningOverride,
  type ProfileScreeningSettings,
} from '../../../../../server/shared/aiSettings'

const editableSteps: Array<{ id: AiStep; title: string }> = [
  { id: 'interestMatch', title: 'Interest matching' },
  { id: 'leadPostPerson', title: 'Person in lead posts' },
]

const tabs = [
  { id: 'profile', label: 'Profile screening' },
  { id: 'interestMatch', label: 'Interest matching' },
  { id: 'leadPostPerson', label: 'Person detection' },
] as const

function ModelSelect({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string
  value: string
  disabled: boolean
  onChange: (model: string) => void
}) {
  return (
    <Select value={value} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full border-line bg-field text-ink">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="panel-dropdown">
        {DECISION_MODELS.map((model) => (
          <SelectItem key={model} value={model}>
            {model}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function PromptField({
  id,
  label,
  hint,
  value,
  disabled,
  rows = 5,
  onChange,
}: {
  id: string
  label: string
  hint?: string
  value: string
  disabled: boolean
  rows?: number
  onChange: (value: string) => void
}) {
  return (
    <Field id={id} label={label}>
      <Textarea
        id={id}
        rows={rows}
        value={value}
        disabled={disabled}
        maxLength={MAX_AI_PROMPT_LENGTH}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <p className="text-xs text-muted-copy">{hint}</p>}
    </Field>
  )
}

/** One model per step, and every prompt is editable text. */
function ScreeningPanel({
  settings,
  disabled,
  onChange,
  onReset,
}: {
  settings: ProfileScreeningSettings
  disabled: boolean
  onChange: (patch: ProfileScreeningOverride) => void
  onReset: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-ink">Profile screening</h4>
        <Button
          type="button"
          variant="ghost"
          className="h-8 px-2 text-xs"
          disabled={disabled}
          onClick={onReset}
        >
          <RotateCcw className="size-3.5" />
          Reset
        </Button>
      </div>
      <Field id="ai-profile-model" label="Category model">
        <ModelSelect
          id="ai-profile-model"
          value={settings.model}
          disabled={disabled}
          onChange={(model) => onChange({ model })}
        />
        <p className="text-xs text-muted-copy">
          Picks male, female or business from the profile screenshot. If the model refuses, the
          lead is skipped.
        </p>
      </Field>
      <Field id="ai-profile-follow-model" label="Text language model">
        <ModelSelect
          id="ai-profile-follow-model"
          value={settings.followModel}
          disabled={disabled}
          onChange={(followModel) => onChange({ followModel })}
        />
        <p className="text-xs text-muted-copy">
          Second step, run only when the first one says male. Skip when non-English text reaches
          70% confidence. Empty fields and no posts pass this check.
        </p>
      </Field>
      <PromptField
        id="ai-profile-state"
        label="Screenshot instructions"
        value={settings.state}
        disabled={disabled}
        onChange={(state) => onChange({ state })}
      />
      <PromptField
        id="ai-profile-instructions"
        label="Category question"
        rows={4}
        value={settings.instructions}
        disabled={disabled}
        onChange={(instructions) => onChange({ instructions })}
      />
      {SCREENING_CHOICES.map((choice) => (
        <PromptField
          key={choice}
          id={`ai-profile-criteria-${choice}`}
          label={`Choice: ${choice}`}
          rows={3}
          value={settings.criteria[choice]}
          disabled={disabled}
          onChange={(text) => onChange({ criteria: { [choice]: text } })}
        />
      ))}
      <PromptField
        id="ai-profile-non-english-text"
        label="Skip check: contains non-English text"
        rows={4}
        value={settings.nonEnglishText}
        disabled={disabled}
        onChange={(nonEnglishText) => onChange({ nonEnglishText })}
      />
    </div>
  )
}

export function RoutineAi({
  value = {},
  disabled,
  onChange,
}: {
  value?: AiSettings
  disabled: boolean
  onChange: (value: AiSettings) => void
}) {
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('profile')
  const id = useId()
  const screening = profileScreeningSettings(value)
  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <div
        role="tablist"
        aria-label="AI settings steps"
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-line-soft"
      >
        {tabs.map((item, index) => (
          <button
            key={item.id}
            id={`${id}-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`${id}-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % tabs.length
                  : event.key === 'ArrowLeft'
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : undefined
              if (next === undefined) return
              event.preventDefault()
              setTab(tabs[next].id)
              event.currentTarget.parentElement
                ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                .item(next)?.focus()
            }}
            className={cn(
              'shrink-0 border-b-2 px-3 py-2 text-sm font-medium',
              tab === item.id
                ? 'border-ink text-ink'
                : 'border-transparent text-subtle-copy hover:text-ink',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <section
        id={`${id}-panel-profile`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-profile`}
        hidden={tab !== 'profile'}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border border-line-soft p-4"
      >
        <ScreeningPanel
          settings={screening}
          disabled={disabled}
          onReset={() => {
            const next = { ...value }
            delete next.profileScreening
            onChange(next)
          }}
          onChange={(patch) => {
            // Only what changed is stored, so untouched wording keeps following the defaults.
            const next: ProfileScreeningOverride = {
              ...value.profileScreening,
              ...patch,
              criteria: { ...value.profileScreening?.criteria, ...patch.criteria },
            }
            for (const key of Object.keys(next) as (keyof ProfileScreeningOverride)[])
              if (
                next[key] === undefined ||
                (key === 'criteria' && !Object.keys(next.criteria ?? {}).length)
              )
                delete next[key]
            onChange({ ...value, profileScreening: next })
          }}
        />
      </section>
      {editableSteps.map((step) => {
        const settings = aiStepSettings(step.id, value)
        const update = (patch: Partial<typeof settings>) =>
          onChange({ ...value, [step.id]: { ...settings, ...patch } })
        return (
          <section
            key={step.id}
            id={`${id}-panel-${step.id}`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-${step.id}`}
            hidden={tab !== step.id}
            className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain rounded-xl border border-line-soft p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-ink">{step.title}</h4>
              <Button
                type="button"
                variant="ghost"
                className="h-8 px-2 text-xs"
                disabled={disabled || !value[step.id]}
                onClick={() => {
                  const next = { ...value }
                  delete next[step.id]
                  onChange(next)
                }}
              >
                <RotateCcw className="size-3.5" />
                Reset
              </Button>
            </div>
            <Field id={`ai-${step.id}-model`} label="AI model">
              <ModelSelect
                id={`ai-${step.id}-model`}
                value={settings.model}
                disabled={disabled}
                onChange={(model) => update({ model })}
              />
            </Field>
            <PromptField
              id={`ai-${step.id}-prompt`}
              label="Prompt"
              rows={9}
              value={settings.prompt}
              disabled={disabled}
              onChange={(prompt) => update({ prompt })}
            />
          </section>
        )
      })}
    </div>
  )
}
