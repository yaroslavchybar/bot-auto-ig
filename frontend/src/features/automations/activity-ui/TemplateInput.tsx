import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Plus, Trash2, Edit2, Save, X, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import type { ActivityInput } from '@/features/automations/activities/types'

interface TemplateInputProps {
  input: ActivityInput
  config?: Record<string, unknown>
}

const MACROS = [
  { id: 'userName', label: '{userName}', desc: 'Instagram username' },
  { id: 'fullName', label: '{fullName}', desc: 'Full profile name' },
  { id: 'matchedName', label: '{matchedName}', desc: 'Extracted first name' },
]

function resolveTemplateKind(
  input: ActivityInput,
  config?: Record<string, unknown>,
): 'message' | 'message_2' {
  const fieldName = input.templateKindField
  const rawValue = fieldName && config ? String(config[fieldName] ?? '').trim() : ''
  return rawValue === 'message_2' ? 'message_2' : 'message'
}

/* ── Macro dropdown content ── */

function MacroDropdownContent({
  macroDropdownOpen,
  onOpenChange,
  insertMacro,
  children,
}: {
  macroDropdownOpen: boolean
  onOpenChange: (open: boolean) => void
  insertMacro: (label: string) => void
  children: React.ReactNode
}) {
  return (
    <Popover open={macroDropdownOpen} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-48 rounded-[2px] border-line bg-panel p-0 shadow-md"
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(e: Event) => e.preventDefault()}
      >
        <div className="max-h-60 overflow-y-auto bg-panel">
          {MACROS.map((macro) => (
            <Button
              key={macro.id}
              variant="ghost"
              className="h-auto w-full justify-start rounded-none px-2 py-1.5 text-[11px] font-normal hover:bg-panel-hover"
              onClick={() => insertMacro(macro.label)}
            >
              <div className="flex flex-col items-start gap-0.5">
                <span className="rounded-[2px] border border-line bg-panel-muted px-1 font-mono text-[10px] text-copy">
                  {macro.label}
                </span>
                <span className="text-[10px] text-subtle-copy">{macro.desc}</span>
              </div>
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/* ── New template form ── */

function TemplateCreateForm(props: SharedEditorProps) {
  return (
    <div className="relative space-y-2 rounded-[3px] border border-line-strong bg-panel-subtle p-2">
      <span className="text-[10px] font-bold tracking-wider text-copy uppercase">NEW TEMPLATE</span>
      <TemplateTextarea {...props} placeholder="Enter message... (type / for macros)" />
      <div className="flex justify-end gap-1.5 border-t border-line-soft pt-1">
        <Button
          variant="outline"
          size="sm"
          className="h-6 rounded-[3px] border-line bg-panel px-2.5 text-[10px] text-copy hover:bg-panel-hover"
          onClick={props.onCancel}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-6 rounded-[3px] brand-button px-2.5 text-[10px]"
          onClick={props.onSave}
        >
          Save
        </Button>
      </div>
    </div>
  )
}

/* ── Inline template editor ── */

function TemplateEditItem(props: SharedEditorProps) {
  return (
    <div className="relative space-y-1.5 rounded-[3px] border border-line-strong bg-panel-subtle p-1.5">
      <TemplateTextarea {...props} placeholder="Enter message... (type / for macros)" />
      <div className="flex justify-end gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-5 rounded-[2px] px-1.5 text-subtle-copy hover:bg-panel-hover"
          onClick={props.onCancel}
        >
          <X className="h-[10px] w-[10px]" />
        </Button>
        <Button
          size="sm"
          className="h-5 rounded-[2px] bg-primary px-1.5 text-primary-foreground hover:bg-primary/90"
          onClick={props.onSave}
        >
          <Save className="h-[10px] w-[10px]" />
        </Button>
      </div>
    </div>
  )
}

/* ── Shared textarea with macro dropdown ── */

interface SharedEditorProps {
  editValue: string
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  macroDropdownOpen: boolean
  onMacroDropdownChange: (open: boolean) => void
  onTextareaChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  insertMacro: (label: string) => void
  onCancel: () => void
  onSave: () => void
}

function TemplateTextarea({
  editValue,
  textareaRef,
  macroDropdownOpen,
  onMacroDropdownChange,
  onTextareaChange,
  insertMacro,
  placeholder,
}: SharedEditorProps & { placeholder?: string }) {
  return (
    <MacroDropdownContent
      macroDropdownOpen={macroDropdownOpen}
      onOpenChange={onMacroDropdownChange}
      insertMacro={insertMacro}
    >
      <div className="relative w-full">
        <Textarea
          ref={textareaRef}
          value={editValue}
          onChange={onTextareaChange}
          placeholder={placeholder}
          className="min-h-[50px] rounded-[2px] border-line bg-field text-[11px] focus-visible:ring-1 focus-visible:ring-offset-0"
        />
      </div>
    </MacroDropdownContent>
  )
}

/* ── Read-only template display ── */

function TemplateDisplayItem({
  template,
  index,
  onStartEdit,
  onDelete,
}: {
  template: string
  index: number
  onStartEdit: (index: number) => void
  onDelete: (index: number) => void
}) {
  return (
    <div className="group rounded-[3px] border border-line bg-panel-subtle p-1.5 hover:border-line-strong">
      <div className="flex items-start gap-1.5">
        <p className="flex-1 text-[11px] font-medium break-words whitespace-pre-wrap text-muted-copy">
          {template.length > 80 ? template.slice(0, 80) + '...' : template}
        </p>
        <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 rounded-[2px] text-subtle-copy hover:bg-panel-hover hover:text-ink"
            onClick={() => onStartEdit(index)}
          >
            <Edit2 className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 rounded-[2px] text-status-danger hover:bg-status-danger-soft hover:text-status-danger"
            onClick={() => onDelete(index)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ── Macro insertion helper ── */

function applyMacroInsertion(
  textareaEl: HTMLTextAreaElement,
  currentValue: string,
  macroLabel: string,
  setValue: (v: string) => void,
  closeMacro: () => void,
) {
  const cursorPosition = textareaEl.selectionStart
  const before = currentValue.slice(0, cursorPosition)
  const after = currentValue.slice(cursorPosition)
  const newBefore = before.endsWith('/') ? before.slice(0, -1) : before
  setValue(newBefore + macroLabel + after)
  closeMacro()
  setTimeout(() => {
    textareaEl.focus()
    const newPos = newBefore.length + macroLabel.length
    textareaEl.setSelectionRange(newPos, newPos)
  }, 0)
}

/* ── Template editing logic ── */

function useTemplateEditor(
  templates: string[] | undefined,
  templateKind: 'message' | 'message_2',
  upsertMutation: ReturnType<typeof useMutation<typeof api.messageTemplates.upsert>>,
) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [macroDropdownOpen, setMacroDropdownOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMacroDropdownOpen(false)
    }
    if (macroDropdownOpen) document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [macroDropdownOpen])

  const handleSave = async () => {
    const trimmed = editValue.trim()
    if (!trimmed || !templates) {
      setEditingIndex(null)
      setIsCreating(false)
      return
    }
    const next = [...templates]
    if (isCreating) next.push(trimmed)
    else if (editingIndex !== null) next[editingIndex] = trimmed
    try {
      await upsertMutation({ kind: templateKind, texts: next })
      setEditingIndex(null)
      setIsCreating(false)
      setEditValue('')
      toast.success('Template saved')
    } catch {
      toast.error('Failed to save template')
    }
  }

  const handleDelete = async (index: number) => {
    if (!templates) return
    const next = [...templates]
    next.splice(index, 1)
    try {
      await upsertMutation({ kind: templateKind, texts: next })
      toast.success('Template deleted')
    } catch {
      toast.error('Failed to delete template')
    }
  }

  const startEdit = (index: number) => {
    if (!templates) return
    setEditingIndex(index)
    setEditValue(templates[index])
    setIsCreating(false)
  }

  const startCreate = () => {
    setEditingIndex(null)
    setEditValue('')
    setIsCreating(true)
  }
  const cancelEdit = () => {
    setEditingIndex(null)
    setEditValue('')
    setIsCreating(false)
  }

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setEditValue(val)
    const cursorPosition = e.target.selectionStart
    const textBeforeCursor = val.slice(0, cursorPosition)
    setMacroDropdownOpen(textBeforeCursor.endsWith('/'))
  }

  const insertMacro = (macroLabel: string) => {
    if (!textareaRef.current) return
    applyMacroInsertion(textareaRef.current, editValue, macroLabel, setEditValue, () =>
      setMacroDropdownOpen(false),
    )
  }

  return {
    editingIndex,
    editValue,
    isCreating,
    macroDropdownOpen,
    textareaRef,
    setMacroDropdownOpen,
    handleSave,
    handleDelete,
    startEdit,
    startCreate,
    cancelEdit,
    handleTextareaChange,
    insertMacro,
  }
}

/* ── Main Component ── */

export function TemplateInput({ input, config }: TemplateInputProps) {
  const templateKind = resolveTemplateKind(input, config)
  const templates = useQuery(api.messageTemplates.get, { kind: templateKind }) as
    | string[]
    | undefined
  const upsertMutation = useMutation(api.messageTemplates.upsert)
  const editor = useTemplateEditor(templates, templateKind, upsertMutation)

  const sharedEditorProps: SharedEditorProps = {
    editValue: editor.editValue,
    textareaRef: editor.textareaRef,
    macroDropdownOpen: editor.macroDropdownOpen,
    onMacroDropdownChange: editor.setMacroDropdownOpen,
    onTextareaChange: editor.handleTextareaChange,
    insertMacro: editor.insertMacro,
    onCancel: editor.cancelEdit,
    onSave: editor.handleSave,
  }

  return (
    <div className="space-y-1">
      <div className="mt-1 mb-0.5 flex items-center justify-between">
        <Label className="text-[11px] font-medium text-copy">{input.label}</Label>
        <Button
          variant="outline"
          size="sm"
          className="h-6 rounded-[3px] border-line bg-panel px-2 text-[10px] text-copy hover:bg-panel-hover"
          onClick={editor.startCreate}
          disabled={editor.isCreating || editor.editingIndex !== null}
        >
          <Plus className="mr-1 h-3 w-3" />
          Add
        </Button>
      </div>

      {editor.isCreating && <TemplateCreateForm {...sharedEditorProps} />}

      <TemplateListContent
        templates={templates}
        isCreating={editor.isCreating}
        editingIndex={editor.editingIndex}
        sharedEditorProps={sharedEditorProps}
        onStartEdit={editor.startEdit}
        onDelete={editor.handleDelete}
      />

      {input.helpText && (
        <p className="pt-1 text-[10px] leading-tight text-subtle-copy">{input.helpText}</p>
      )}
    </div>
  )
}

/* ── Template List Content ── */

function TemplateListContent({
  templates,
  isCreating,
  editingIndex,
  sharedEditorProps,
  onStartEdit,
  onDelete,
}: {
  templates: string[] | undefined
  isCreating: boolean
  editingIndex: number | null
  sharedEditorProps: SharedEditorProps
  onStartEdit: (index: number) => void
  onDelete: (index: number) => void
}) {
  if (templates === undefined) {
    return <div className="py-2 text-[10px] text-subtle-copy">Loading templates...</div>
  }

  if (templates.length === 0 && !isCreating) {
    return (
      <div className="rounded-[3px] border border-dashed border-line bg-panel-subtle p-3 text-center">
        <MessageSquare className="mx-auto mb-1 h-4 w-4 text-subtle-copy opacity-20" />
        <p className="text-[10px] text-subtle-copy">No templates</p>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {templates.map((template, index) => {
        if (editingIndex === index) {
          return <TemplateEditItem key={index} {...sharedEditorProps} />
        }
        return (
          <TemplateDisplayItem
            key={index}
            template={template}
            index={index}
            onStartEdit={onStartEdit}
            onDelete={onDelete}
          />
        )
      })}
    </div>
  )
}
