import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Plus, Search, X } from 'lucide-react'
import { toast } from 'sonner'

import { api } from './../../../../convex/_generated/api'
import type { Id } from './../../../../convex/_generated/dataModel'
import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrapeJobDialog } from './components/ScrapeJobDialog'
import { ScrapeJobsList } from './components/ScrapeJobsList'
import { ScrapedAccountsList } from './components/ScrapedAccountsList'
import type { ScrapeJob, ScrapeJobForm, ScrapedAccount } from './types'
import { DEFAULT_JOB_FORM, jobToForm } from './types'
import {
  getJobSortTimestamp,
  getResultSortTimestamp,
  jobMatchesQuery,
  resultMatchesQuery,
} from './utils'

/* ── Page state ── */

function useScrapeJobsState() {
  const jobsQuery = useQuery(api.scrapeJobs.list, {})
  const accountsQuery = useQuery(api.instagramAccounts.listScraped, { limit: 500 })
  const createJob = useMutation(api.scrapeJobs.create)
  const updateJob = useMutation(api.scrapeJobs.update)
  const removeJob = useMutation(api.scrapeJobs.remove)

  const jobs = useMemo(
    () => (Array.isArray(jobsQuery) ? (jobsQuery as ScrapeJob[]) : []),
    [jobsQuery],
  )
  const accounts = useMemo(
    () => (Array.isArray(accountsQuery) ? (accountsQuery as ScrapedAccount[]) : []),
    [accountsQuery],
  )
  const jobNames = useMemo(() => {
    const names: Record<string, string> = {}
    for (const job of jobs) names[String(job._id)] = job.name
    return names
  }, [jobs])

  const [searchQuery, setSearchQuery] = useState('')
  const [jobDialogOpen, setJobDialogOpen] = useState(false)
  const [editingJob, setEditingJob] = useState<ScrapeJob | null>(null)
  const [savingJob, setSavingJob] = useState(false)
  const [jobError, setJobError] = useState<string | null>(null)
  const [actionPendingId, setActionPendingId] = useState<string | null>(null)
  const [deletingJobId, setDeletingJobId] = useState<Id<'scrapeJobs'> | null>(null)
  const [savingDelete, setSavingDelete] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)

  const isLoading = jobsQuery === undefined || accountsQuery === undefined
  const query = searchQuery.trim().toLowerCase()

  const filteredJobs = useMemo(
    () =>
      [...jobs]
        .sort((a, b) => getJobSortTimestamp(b) - getJobSortTimestamp(a))
        .filter((job) => jobMatchesQuery(job, query)),
    [jobs, query],
  )
  const filteredAccounts = useMemo(
    () =>
      [...accounts]
        .sort((a, b) => getResultSortTimestamp(b) - getResultSortTimestamp(a))
        .filter((account) => resultMatchesQuery(account, query, jobNames[String(account.sourceJobId)] ?? '')),
    [accounts, query, jobNames],
  )

  const deletingJob = jobs.find((job) => job._id === deletingJobId) ?? null

  return {
    jobs, accounts, jobNames, createJob, updateJob, removeJob,
    searchQuery, setSearchQuery,
    jobDialogOpen, setJobDialogOpen,
    editingJob, setEditingJob,
    savingJob, setSavingJob,
    jobError, setJobError,
    actionPendingId, setActionPendingId,
    deletingJobId, setDeletingJobId,
    savingDelete, setSavingDelete,
    pageError, setPageError,
    isLoading, filteredJobs, filteredAccounts,
    deletingJob,
  }
}

type JobsState = ReturnType<typeof useScrapeJobsState>

/* ── Job CRUD + run/stop ── */

function formToMutation(form: ScrapeJobForm) {
  return {
    name: form.name.trim(),
    targets: form.targets,
    listIds: form.listIds as Id<'lists'>[],
    config: {
      maxToScrape: Math.max(0, Math.floor(Number(form.maxToScrape) || 0)),
      maxAttempts: Math.max(1, Math.floor(Number(form.maxAttempts) || 4)),
      retryBackoffSeconds: form.retryBackoffSeconds.trim() || '30,120,600,1800',
      openDelaySeconds: Math.max(0, Math.floor(Number(form.openDelaySeconds) || 0)),
      fields: { ...form.fields },
      skip: { ...form.skip },
    },
  }
}

function useJobActions(state: JobsState) {
  const {
    createJob, updateJob, removeJob,
    setJobDialogOpen, setEditingJob, setSavingJob, setJobError,
    setActionPendingId, setPageError, setDeletingJobId,
    deletingJobId, setSavingDelete,
  } = state

  const handleCreate = useCallback(() => {
    setEditingJob(null); setJobError(null); setJobDialogOpen(true)
  }, [setEditingJob, setJobError, setJobDialogOpen])

  const handleEdit = useCallback((job: ScrapeJob) => {
    setEditingJob(job); setJobError(null); setJobDialogOpen(true)
  }, [setEditingJob, setJobError, setJobDialogOpen])

  const handleSaveJob = useCallback(async (form: ScrapeJobForm) => {
    setSavingJob(true); setJobError(null)
    try {
      if (state.editingJob) {
        await updateJob({ id: state.editingJob._id, ...formToMutation(form) })
        toast.success(`Updated "${form.name}"`)
      } else {
        await createJob(formToMutation(form))
        toast.success(`Created "${form.name}"`)
      }
      setJobDialogOpen(false); setEditingJob(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setJobError(message)
    } finally { setSavingJob(false) }
  }, [createJob, updateJob, setSavingJob, setJobError, setJobDialogOpen, setEditingJob, state.editingJob])

  const handleRun = useCallback(async (job: ScrapeJob) => {
    setActionPendingId(String(job._id)); setPageError(null)
    try {
      await apiFetch('/api/scrape-jobs/run', { method: 'POST', body: { jobId: String(job._id) } })
      toast.success(`Started "${job.name}"`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setPageError(message); toast.error(message)
    } finally { setActionPendingId(null) }
  }, [setActionPendingId, setPageError])

  const handleStop = useCallback(async (job: ScrapeJob) => {
    setActionPendingId(String(job._id)); setPageError(null)
    try {
      await apiFetch('/api/scrape-jobs/stop', { method: 'POST', body: { jobId: String(job._id) } })
      toast.success(`Stopped "${job.name}"`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setPageError(message); toast.error(message)
    } finally { setActionPendingId(null) }
  }, [setActionPendingId, setPageError])

  const handleDeleteClick = useCallback((job: ScrapeJob) => {
    setDeletingJobId(job._id); setPageError(null)
  }, [setDeletingJobId, setPageError])

  const handleConfirmDelete = useCallback(async () => {
    if (!deletingJobId) return
    setSavingDelete(true); setPageError(null)
    try {
      await removeJob({ id: deletingJobId })
      toast.success('Deleted scrape job')
      setDeletingJobId(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setPageError(message); toast.error(message)
    } finally { setSavingDelete(false) }
  }, [deletingJobId, removeJob, setDeletingJobId, setPageError, setSavingDelete])

  return { handleCreate, handleEdit, handleSaveJob, handleRun, handleStop, handleDeleteClick, handleConfirmDelete }
}

/* ── Header ── */

function ScrapeJobsHeader({
  searchQuery,
  onSearchChange,
  onCreate,
  isLoading,
}: {
  searchQuery: string
  onSearchChange: (v: string) => void
  onCreate: () => void
  isLoading: boolean
}) {
  return (
    <div className="relative z-10 flex-none px-4 pt-2 pb-2 md:px-6 md:pt-3 md:pb-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
        <div className="flex flex-grow items-center gap-2">
          <div className="relative flex-1 sm:w-[280px] sm:flex-initial">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-copy" />
            <Input
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search..."
              className="bg-field border border-line text-copy placeholder:text-muted-copy brand-focus h-8 rounded-md pl-9 text-sm font-normal leading-5 shadow-sm"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onSearchChange('')}
            disabled={isLoading}
            aria-label="Clear search"
            title="Clear search"
            className="h-8 w-8 shrink-0 p-0"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Clear</span>
          </Button>
        </div>
        <div className="flex shrink-0 gap-2 sm:flex-row md:ml-auto">
          <Button
            size="icon"
            onClick={onCreate}
            disabled={isLoading}
            className="mobile-effect-shadow brand-button h-8 w-auto px-3.5 text-sm"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Create Job
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ── Main component ── */

export function ScrapedDataPage() {
  const state = useScrapeJobsState()
  const jobs = useJobActions(state)

  return (
    <div className="bg-shell text-ink animate-in fade-in relative flex h-full flex-col duration-300">

      <ScrapeJobsHeader
        searchQuery={state.searchQuery}
        onSearchChange={state.setSearchQuery}
        onCreate={jobs.handleCreate}
        isLoading={state.isLoading}
      />

      {state.pageError && !state.deletingJob && (
        <div className="status-banner-danger relative z-10 flex items-center border-b px-6 py-3 text-sm">
          <span className="status-dot-danger mr-2 h-1.5 w-1.5 rounded-full" />
          {state.pageError}
        </div>
      )}

      <div className="relative z-10 flex-1 overflow-auto px-4 pt-0 pb-4 md:px-6 md:pb-6">
        <div className="mx-auto max-w-[2000px] space-y-8">
          <section>
            <h2 className="text-copy mb-3 text-sm font-semibold tracking-wide uppercase">Jobs</h2>
            <ScrapeJobsList
              jobs={state.filteredJobs}
              loading={state.isLoading}
              actionPendingId={state.actionPendingId}
              onRun={(job) => void jobs.handleRun(job)}
              onStop={(job) => void jobs.handleStop(job)}
              onEdit={jobs.handleEdit}
              onDelete={jobs.handleDeleteClick}
              emptyTitle={state.searchQuery.trim() ? 'No matching jobs' : 'No scrape jobs'}
              emptyDescription={
                state.searchQuery.trim()
                  ? 'Try a different search term or clear the filter.'
                  : 'Create a job to start scraping post likers.'
              }
            />
          </section>
          <section>
            <h2 className="text-copy mb-3 text-sm font-semibold tracking-wide uppercase">
              Accounts · {state.filteredAccounts.length}
            </h2>
            <ScrapedAccountsList
              accounts={state.filteredAccounts}
              jobNames={state.jobNames}
              loading={state.isLoading}
              emptyTitle={state.searchQuery.trim() ? 'No matching accounts' : 'No scraped accounts'}
              emptyDescription={
                state.searchQuery.trim()
                  ? 'Try a different search term or clear the filter.'
                  : 'Completed job runs will add accounts here.'
              }
            />
          </section>
        </div>
      </div>

      <ScrapeJobDialog
        open={state.jobDialogOpen}
        title={state.editingJob ? 'Edit Scrape Job' : 'Create Scrape Job'}
        description={
          state.editingJob
            ? 'Update posts, lists, and scrape limits.'
            : 'Pick posts and profile lists, then run the job.'
        }
        initial={state.editingJob ? jobToForm(state.editingJob) : DEFAULT_JOB_FORM}
        saving={state.savingJob}
        error={state.jobError}
        onClose={() => {
          if (state.savingJob) return
          state.setJobDialogOpen(false)
          state.setEditingJob(null)
        }}
        onSave={(form) => void jobs.handleSaveJob(form)}
      />

      {state.deletingJob ? (
        <ConfirmDeleteDialog
          open={Boolean(state.deletingJob)}
          title="Delete Scrape Job"
          entityLabel="scrape job"
          itemName={state.deletingJob.name || 'Selected job'}
          confirmLabel="Delete Job"
          saving={state.savingDelete}
          error={state.pageError}
          extraDescription="The job will be removed. Already scraped accounts stay in the table."
          onConfirm={() => void jobs.handleConfirmDelete()}
          onCancel={() => {
            if (state.savingDelete) return
            state.setDeletingJobId(null)
          }}
        />
      ) : null}
    </div>
  )
}
