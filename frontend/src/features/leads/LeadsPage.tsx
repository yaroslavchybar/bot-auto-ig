import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { toast } from 'sonner'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { normalizeUsername } from '../../../../convex/leadImport'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { parseLeadImport } from './import'

export function LeadsPage() {
  const lists = useQuery(api.leads.lists, {})
  const [listId, setListId] = useState<Id<'leadLists'> | undefined>()
  const leads = useQuery(api.leads.list, { listId })
  const [name, setName] = useState(''),
    [text, setText] = useState(''),
    [source, setSource] = useState('')
  const [preview, setPreview] = useState<string[] | null>(null),
    [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Id<'leads'>[]>([])
  const create = useMutation(api.leads.createList),
    importLeads = useMutation(api.leads.importLeads),
    setStatus = useMutation(api.leads.setStatus)
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="bg-shell text-ink h-full space-y-5 overflow-auto p-6">
      <h1 className="text-xl font-semibold">Leads</h1>
      <p className="text-subtle-copy text-sm">
        Import recipients, review contact eligibility, then mark them Ready.
        Previously contacted leads are never requeued.
      </p>
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Lead list"
          className="bg-field border-line rounded border p-2"
          value={listId ?? ''}
          onChange={(e) => {
            setListId(
              e.target.value ? (e.target.value as Id<'leadLists'>) : undefined,
            )
            setSelected([])
            setPreview(null)
          }}
        >
          <option value="">All lead lists</option>
          {lists?.map((l) => (
            <option key={l._id} value={l._id}>
              {l.name}
            </option>
          ))}
        </select>
        <Input
          className="max-w-xs"
          aria-label="New list name"
          placeholder="New lead list"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button
          disabled={busy || !name.trim()}
          onClick={() =>
            void act(async () => {
              setListId(await create({ name }))
              setName('')
            })
          }
        >
          Create list
        </Button>
      </div>
      <div className="bg-panel border-line space-y-3 rounded-lg border p-4">
        <Input
          aria-label="Import source"
          placeholder="Source / import notes"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
        <input
          aria-label="Import CSV"
          type="file"
          accept=".csv,.txt"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) {
              if (file.size > 2_000_000) {
                toast.error('File must be under 2 MB')
                return
              }
              void file
                .text()
                .then((t) => {
                  setText(t)
                  setSource(file.name)
                  setPreview(null)
                })
                .catch((e) => toast.error(String(e)))
            }
          }}
        />
        <textarea
          aria-label="Usernames or CSV"
          className="bg-field border-line w-full rounded border p-2"
          rows={4}
          placeholder="Paste usernames, profile URLs, or CSV with a username column"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setPreview(null)
          }}
        />
        <Button
          disabled={!text.trim() || busy}
          variant="outline"
          onClick={() => {
            try {
              const values = parseLeadImport(text)
              if (values.length > 500)
                throw new Error('Import up to 500 rows at once')
              setPreview(values)
            } catch (e) {
              toast.error(String(e))
            }
          }}
        >
          Preview import
        </Button>
        {preview && (
          <div className="space-y-2">
            <p className="text-sm">
              {new Set(preview.map(normalizeUsername).filter(Boolean)).size}{' '}
              unique valid usernames ·{' '}
              {preview.filter((v) => !normalizeUsername(v)).length} invalid
              rows. Existing leads keep their status.
            </p>
            <div className="max-h-36 overflow-auto text-sm">
              {preview.slice(0, 30).map((v, i) => (
                <div key={i}>
                  {normalizeUsername(v)
                    ? `@${normalizeUsername(v)}`
                    : `Invalid: ${v}`}
                </div>
              ))}
            </div>
            <Button
              disabled={!listId || busy}
              onClick={() =>
                void act(async () => {
                  const result = await importLeads({
                    listId: listId!,
                    usernames: preview,
                    source,
                  })
                  toast.success(
                    `${result.added} added, ${result.duplicates} duplicates, ${result.invalid} invalid`,
                  )
                  setPreview(null)
                  setText('')
                })
              }
            >
              Import into selected list
            </Button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {(['ready', 'contacted', 'replied', 'do_not_contact'] as const).map(
          (status) => (
            <Button
              key={status}
              variant="outline"
              disabled={busy || !selected.length}
              onClick={() =>
                void act(async () => {
                  await setStatus({ ids: selected, status })
                  setSelected([])
                })
              }
            >
              {
                {
                  ready: 'Mark Ready',
                  contacted: 'Confirm contacted',
                  replied: 'Mark replied',
                  do_not_contact: 'Do not contact',
                }[status]
              }
            </Button>
          ),
        )}
      </div>
      {leads === undefined ? (
        <p>Loading leads…</p>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>Select</th>
                <th>Username</th>
                <th>Status</th>
                <th>Sender</th>
                <th>Source</th>
                <th>Imported</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l._id} className="border-line border-t">
                  <td className="p-2">
                    <input
                      aria-label={`Select ${l.username}`}
                      type="checkbox"
                      checked={selected.includes(l._id)}
                      onChange={(e) =>
                        setSelected((ids) =>
                          e.target.checked
                            ? [...ids, l._id]
                            : ids.filter((id) => id !== l._id),
                        )
                      }
                    />
                  </td>
                  <td>
                    <a
                      href={`https://www.instagram.com/${l.username}/`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      @{l.username}
                    </a>
                  </td>
                  <td>{l.status.replaceAll('_', ' ')}</td>
                  <td>{l.senderName ?? '—'}</td>
                  <td>{l.source}</td>
                  <td>{new Date(l.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!leads.length && <p className="py-4">No leads in this list.</p>}
        </div>
      )}
    </div>
  )
}
