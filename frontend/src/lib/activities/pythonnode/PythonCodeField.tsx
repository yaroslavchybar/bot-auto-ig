import { useRef, useEffect, useCallback, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection } from '@codemirror/view'
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands'
import { python } from '@codemirror/lang-python'
import { syntaxHighlighting, indentOnInput, bracketMatching, foldGutter, foldKeymap, HighlightStyle } from '@codemirror/language'
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { tags } from '@lezer/highlight'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Maximize2, X, Check } from 'lucide-react'
import type { ActivityInput } from '../types'

/* ── Dark theme matching the app's utilitarian aesthetic ── */
const editorTheme = EditorView.theme({
    '&': {
        fontSize: '12px',
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "Consolas", monospace',
        backgroundColor: '#0d0d0d',
        color: '#d4d4d4',
        borderRadius: '2px',
        border: '1px solid #2a2a2a',
    },
    '&.cm-focused': {
        outline: '1px solid #525252',
    },
    '.cm-content': {
        padding: '8px 0',
        caretColor: '#e5e5e5',
        lineHeight: '1.6',
    },
    '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: '#e5e5e5',
        borderLeftWidth: '1.5px',
    },
    '.cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: '#264f78 !important',
    },
    '.cm-activeLine': {
        backgroundColor: '#1a1a1a',
    },
    '.cm-gutters': {
        backgroundColor: '#0d0d0d',
        color: '#555',
        border: 'none',
        borderRight: '1px solid #1f1f1f',
        minWidth: '36px',
    },
    '.cm-activeLineGutter': {
        backgroundColor: '#1a1a1a',
        color: '#888',
    },
    '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 8px 0 4px',
        fontSize: '10px',
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    },
    '.cm-foldGutter .cm-gutterElement': {
        padding: '0 2px',
        cursor: 'pointer',
        color: '#555',
    },
    '.cm-foldGutter .cm-gutterElement:hover': {
        color: '#aaa',
    },
    '.cm-matchingBracket': {
        backgroundColor: '#3a3a3a',
        outline: '1px solid #555',
        color: '#e5e5e5 !important',
    },
    '.cm-searchMatch': {
        backgroundColor: '#515c3a',
        outline: '1px solid #6b7a4a',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: '#3a5c7a',
    },
    '.cm-tooltip': {
        backgroundColor: '#1e1e1e',
        border: '1px solid #333',
        borderRadius: '2px',
        color: '#d4d4d4',
        fontSize: '11px',
    },
    '.cm-tooltip.cm-tooltip-autocomplete': {
        '& > ul > li': {
            padding: '2px 8px',
        },
        '& > ul > li[aria-selected]': {
            backgroundColor: '#264f78',
            color: '#fff',
        },
    },
    '.cm-panels': {
        backgroundColor: '#1a1a1a',
        color: '#d4d4d4',
    },
    '.cm-panels.cm-panels-top': {
        borderBottom: '1px solid #333',
    },
    '.cm-panel.cm-search': {
        padding: '4px 8px',
    },
    '.cm-panel.cm-search input, .cm-panel.cm-search button': {
        fontSize: '11px',
    },
    '.cm-scroller': {
        overflow: 'auto',
    },
}, { dark: true })

/* ── Syntax highlighting (VS Code–inspired for Python) ── */
const syntaxColors = HighlightStyle.define([
    { tag: tags.keyword, color: '#c586c0' },
    { tag: tags.controlKeyword, color: '#c586c0' },
    { tag: tags.operatorKeyword, color: '#c586c0' },
    { tag: tags.definitionKeyword, color: '#569cd6' },
    { tag: tags.moduleKeyword, color: '#c586c0' },
    { tag: tags.operator, color: '#d4d4d4' },
    { tag: tags.separator, color: '#d4d4d4' },
    { tag: tags.punctuation, color: '#d4d4d4' },
    { tag: tags.bracket, color: '#ffd700' },
    { tag: tags.angleBracket, color: '#ffd700' },
    { tag: tags.squareBracket, color: '#da70d6' },
    { tag: tags.paren, color: '#ffd700' },
    { tag: tags.brace, color: '#da70d6' },
    { tag: tags.number, color: '#b5cea8' },
    { tag: tags.integer, color: '#b5cea8' },
    { tag: tags.float, color: '#b5cea8' },
    { tag: tags.string, color: '#ce9178' },
    { tag: tags.special(tags.string), color: '#d7ba7d' },
    { tag: tags.regexp, color: '#d16969' },
    { tag: tags.escape, color: '#d7ba7d' },
    { tag: tags.comment, color: '#6a9955', fontStyle: 'italic' },
    { tag: tags.lineComment, color: '#6a9955', fontStyle: 'italic' },
    { tag: tags.blockComment, color: '#6a9955', fontStyle: 'italic' },
    { tag: tags.docComment, color: '#608b4e', fontStyle: 'italic' },
    { tag: tags.variableName, color: '#9cdcfe' },
    { tag: tags.definition(tags.variableName), color: '#4fc1ff' },
    { tag: tags.function(tags.variableName), color: '#dcdcaa' },
    { tag: tags.definition(tags.function(tags.variableName)), color: '#dcdcaa' },
    { tag: tags.typeName, color: '#4ec9b0' },
    { tag: tags.className, color: '#4ec9b0' },
    { tag: tags.propertyName, color: '#9cdcfe' },
    { tag: tags.function(tags.propertyName), color: '#dcdcaa' },
    { tag: tags.definition(tags.propertyName), color: '#9cdcfe' },
    { tag: tags.bool, color: '#569cd6' },
    { tag: tags.null, color: '#569cd6' },
    { tag: tags.self, color: '#569cd6' },
    { tag: tags.atom, color: '#569cd6' },
    { tag: tags.labelName, color: '#c8c8c8' },
    { tag: tags.attributeName, color: '#9cdcfe' },
    { tag: tags.derefOperator, color: '#d4d4d4' },
])

/* ── Shared extensions builder ── */
function createExtensions(onDocChange: (doc: string) => void) {
    return [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        rectangularSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        foldGutter(),
        history(),
        highlightSelectionMatches(),
        autocompletion(),
        python(),
        syntaxHighlighting(syntaxColors),
        editorTheme,
        keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
            ...searchKeymap,
            indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                onDocChange(update.state.doc.toString())
            }
        }),
        EditorView.lineWrapping,
        EditorState.tabSize.of(4),
    ]
}

/* ── Inline (sidebar) editor ── */
function InlineEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const containerRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView | null>(null)
    const onChangeRef = useRef(onChange)

    useEffect(() => { onChangeRef.current = onChange }, [onChange])

    useEffect(() => {
        if (!containerRef.current) return
        const view = new EditorView({
            state: EditorState.create({
                doc: value,
                extensions: createExtensions((doc) => onChangeRef.current(doc)),
            }),
            parent: containerRef.current,
        })
        viewRef.current = view
        return () => { view.destroy(); viewRef.current = null }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // sync external changes
    useEffect(() => {
        const view = viewRef.current
        if (!view) return
        const cur = view.state.doc.toString()
        if (cur !== value) {
            view.dispatch({ changes: { from: 0, to: cur.length, insert: value } })
        }
    }, [value])

    return (
        <div
            ref={containerRef}
            className="overflow-hidden rounded-[2px] min-h-[120px] max-h-[300px]"
            style={{ resize: 'vertical', overflow: 'auto' }}
        />
    )
}

/* ── Modal (popup) editor ── */
function ModalEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const containerRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView | null>(null)
    const onChangeRef = useRef(onChange)

    useEffect(() => { onChangeRef.current = onChange }, [onChange])

    useEffect(() => {
        if (!containerRef.current) return
        const view = new EditorView({
            state: EditorState.create({
                doc: value,
                extensions: createExtensions((doc) => onChangeRef.current(doc)),
            }),
            parent: containerRef.current,
        })
        viewRef.current = view
        // auto-focus the editor
        view.focus()
        return () => { view.destroy(); viewRef.current = null }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // sync external changes
    useEffect(() => {
        const view = viewRef.current
        if (!view) return
        const cur = view.state.doc.toString()
        if (cur !== value) {
            view.dispatch({ changes: { from: 0, to: cur.length, insert: value } })
        }
    }, [value])

    return (
        <div
            ref={containerRef}
            className="overflow-hidden rounded-[2px] flex-1"
            style={{ minHeight: '100%' }}
        />
    )
}

/* ── Main Component ── */
interface PythonCodeFieldProps {
    input: ActivityInput
    value: unknown
    onChange: (value: unknown) => void
}

export function PythonCodeField({ input, value, onChange }: PythonCodeFieldProps) {
    const [modalOpen, setModalOpen] = useState(false)
    const displayValue = (value ?? input.default ?? '') as string

    const handleChange = useCallback((newValue: string) => {
        onChange(newValue)
    }, [onChange])

    const lineCount = displayValue.split('\n').length
    const charCount = displayValue.length

    return (
        <>
            <div className="space-y-1.5">
                <Label
                    htmlFor={input.name}
                    className="flex justify-between items-center text-[11px] font-medium text-neutral-700 dark:text-neutral-300"
                >
                    <span className="flex items-center gap-1.5">
                        <span className="inline-flex items-center px-1 py-0.5 rounded-[2px] bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 text-[9px] font-bold font-mono tracking-wide">
                            PY
                        </span>
                        {input.label}
                        {input.required && <span className="text-red-500 ml-0.5">*</span>}
                    </span>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 rounded-[2px] text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700/50"
                        onClick={() => setModalOpen(true)}
                        title="Open in full editor"
                    >
                        <Maximize2 className="h-3 w-3" />
                    </Button>
                </Label>

                {/* Inline compact editor */}
                <InlineEditor value={displayValue} onChange={handleChange} />

                {/* Footer bar */}
                <div className="flex items-center justify-between px-0.5">
                    {input.helpText && (
                        <p className="text-[10px] text-neutral-500 dark:text-neutral-400 leading-tight">
                            <span className="text-yellow-600/60 dark:text-yellow-400/60 font-mono mr-1">ℹ</span>
                            {input.helpText}
                        </p>
                    )}
                    <p className="text-[9px] text-neutral-500 font-mono ml-auto shrink-0">
                        {lineCount}L · {charCount}C
                    </p>
                </div>
            </div>

            {/* ── Expanded modal editor ── */}
            <Dialog open={modalOpen} onOpenChange={setModalOpen}>
                <DialogContent
                    hideClose
                    className="max-w-[85vw] w-[85vw] h-[80vh] p-0 gap-0 bg-[#0d0d0d] border-neutral-700 rounded-[4px] flex flex-col overflow-hidden"
                >
                    <DialogHeader className="px-4 py-2.5 border-b border-neutral-800 bg-[#141414] flex-row items-center justify-between space-y-0 shrink-0">
                        <div className="flex items-center gap-2.5">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-[2px] bg-yellow-500/15 text-yellow-500 text-[10px] font-bold font-mono tracking-wider">
                                PYTHON
                            </span>
                            <DialogTitle className="text-[12px] font-semibold text-neutral-300 tracking-wide">
                                {input.label}
                            </DialogTitle>
                            <DialogDescription className="sr-only">
                                Edit Python code in full-screen mode
                            </DialogDescription>
                            <span className="text-[10px] text-neutral-600 font-mono">
                                {lineCount} lines · {charCount} chars
                            </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2.5 rounded-[2px] text-[10px] font-medium text-green-400 hover:text-green-300 hover:bg-green-500/10 gap-1"
                                onClick={() => setModalOpen(false)}
                            >
                                <Check className="h-3 w-3" />
                                Done
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 rounded-[2px] text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800"
                                onClick={() => setModalOpen(false)}
                            >
                                <X className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </DialogHeader>

                    {/* Full-size editor area */}
                    <div className="flex-1 overflow-hidden">
                        <ModalEditor value={displayValue} onChange={handleChange} />
                    </div>

                    {/* Status bar */}
                    <div className="px-4 py-1.5 border-t border-neutral-800 bg-[#141414] flex items-center justify-between text-[10px] text-neutral-500 font-mono shrink-0">
                        <div className="flex items-center gap-3">
                            <span>Python</span>
                            <span>UTF-8</span>
                            <span>Spaces: 4</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <span>{lineCount} lines</span>
                            <span>{charCount} characters</span>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}
