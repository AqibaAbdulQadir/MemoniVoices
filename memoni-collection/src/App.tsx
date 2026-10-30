
import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  CircleHelp,
  FileAudio,
  Heart,
  ListChecks,
  LogOut,
  Mic,
  Pause,
  Play,
  Search,
  Square,
  Volume2,
  X,
} from 'lucide-react'

const API_URL = import.meta.env.VITE_API_URL || ''
const PAGE_SIZE = 10

type Sentence = {
  id: number
  urdu: string
  position: number
  submissionId: string | null
}

type Entry = {
  text: string
  audioUrl: string | null
  audioBlob: Blob | null
}

type ApiSentence = {
  id: number
  source_urdu: string
  position: number
  status?: string | null
  submission_id?: string | null
  romanized_memoni?: string | null
}

type SentenceResponse = {
  sentences: ApiSentence[]
  total: number
  completed: number
  page: number
  pageSize: number
}

type Filter = 'all' | 'pending' | 'completed'
type Page = 'editor' | 'browser'

async function verifyVolunteer(key: string) {
  const response = await fetch(`${API_URL}/api/volunteer/access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.error || 'Invalid access key.')
  }

  return data
}

async function fetchAssignedSentences(
  key: string,
  page: number,
): Promise<SentenceResponse> {
  const response = await fetch(
    `${API_URL}/api/sentences?page=${page}&pageSize=${PAGE_SIZE}`,
    {
      headers: {
        Authorization: `Bearer ${key}`,
      },
    },
  )

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.error || 'Could not load assigned sentences.')
  }

  if (!Array.isArray(data.sentences)) {
    throw new Error('Unexpected response from the server.')
  }

  return data as SentenceResponse
}
function isCompleted(item: ApiSentence) {
  return Boolean(
    item.submission_id ||
    item.status === 'submitted' ||
    item.status === 'published',
  )
}

export default function App() {
  const [successMessage, setSuccessMessage] = useState('')
  const [sentencePage, setSentencePage] = useState(1)
  const [assignedTotal, setAssignedTotal] = useState(0)
  const [completedTotal, setCompletedTotal] = useState(0)
  const [sentences, setSentences] = useState<Sentence[]>([])
  const [loadingSentences, setLoadingSentences] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [authenticated, setAuthenticated] = useState(false)
  const [accessKey, setAccessKey] = useState('')
  const [loginKey, setLoginKey] = useState('')
  const [loginError, setLoginError] = useState('')
  const [saving, setSaving] = useState(false)

  const [index, setIndex] = useState(0)
  const [entries, setEntries] = useState<Record<number, Entry>>({})
  const [completed, setCompleted] = useState<number[]>([])

  const [page, setPage] = useState<Page>('editor')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)

  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<BlobPart[]>([])
  const stream = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  function createEntries(data: ApiSentence[]) {
    const loadedEntries: Record<number, Entry> = {}
    const completedIds: number[] = []

    for (const item of data) {
      loadedEntries[item.id] = {
        text: item.romanized_memoni || '',
        audioUrl: null,
        audioBlob: null,
        
      }

      if (isCompleted(item)) {
        completedIds.push(item.id)
      }
    }

    return { loadedEntries, completedIds }
  }

  async function loadVolunteerData(key: string) {
    await verifyVolunteer(key)

    const result = await fetchAssignedSentences(key, 1)
    applySentencePage(result)

    setAccessKey(key)
  }
  function applySentencePage(result: SentenceResponse) {
    const loadedSentences: Sentence[] = result.sentences.map(item => ({
      id: item.id,
      urdu: item.source_urdu,
      position: item.position,
      submissionId: item.submission_id ?? null,
    }))

    const { loadedEntries, completedIds } = createEntries(result.sentences)

    setSentences(loadedSentences)

    // Preserve drafts and completed entries from previously visited pages.
    setEntries(previous => {
      const merged: Record<number, Entry> = { ...previous }

      for (const [id, next] of Object.entries(loadedEntries)) {
        const sentenceId = Number(id)
        const existing = previous[sentenceId]

        merged[sentenceId] = {
          text: existing?.text ?? next.text,
          audioUrl: existing?.audioUrl ?? next.audioUrl,
          audioBlob: existing?.audioBlob ?? next.audioBlob,
        }
      }

      return merged
    })

    setCompleted(previous =>
      Array.from(new Set([...previous, ...completedIds])),
    )

    setAssignedTotal(result.total)
    setCompletedTotal(result.completed)
    setSentencePage(result.page)

    const firstIncomplete = loadedSentences.findIndex(
      item => !completedIds.includes(item.id),
    )

    setIndex(firstIncomplete >= 0 ? firstIncomplete : 0)
  }

  async function changeSentencePage(nextPage: number) {
    const totalPages = Math.ceil(assignedTotal / PAGE_SIZE)

    if (nextPage < 1 || nextPage > totalPages) return

    setLoadingSentences(true)
    setError('')

    try {
      const result = await fetchAssignedSentences(accessKey, nextPage)

      applySentencePage(result)
      setPage('browser')
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not load this page.',
      )
    } finally {
      setLoadingSentences(false)
    }
  }
  // Restore the volunteer session.
  useEffect(() => {
    let cancelled = false

    async function initialise() {
      const storedKey = sessionStorage.getItem('memoni-access-key')

      if (!storedKey) {
        setLoadingSentences(false)
        return
      }

      try {
        await loadVolunteerData(storedKey)

        if (!cancelled) {
          setAuthenticated(true)
        }
      } catch (err) {
        console.error('Session restoration failed:', err)

        if (!cancelled) {
          setLoadError(
            err instanceof Error
              ? err.message
              : 'Could not restore your session.',
          )
        }
      } finally {
        if (!cancelled) {
          setLoadingSentences(false)
        }
      }
    }

    void initialise()

    return () => {
      cancelled = true
    }
  }, [])

  // Release microphone resources when the app unmounts.
  useEffect(() => {
    return () => {
      stream.current?.getTracks().forEach(track => track.stop())

      if (recorder.current?.state === 'recording') {
        recorder.current.stop()
      }
    }
  }, [])

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setLoginError('')
    setLoadError('')
    setLoadingSentences(true)

    try {
      const key = loginKey.trim()

      await loadVolunteerData(key)

      sessionStorage.setItem('memoni-access-key', key)
      setAuthenticated(true)
      setPage('editor')
    } catch (err) {
      setLoginError(
        err instanceof Error ? err.message : 'Login failed.',
      )
    } finally {
      setLoadingSentences(false)
    }
  }

  function handleLogout() {
    if (recorder.current?.state === 'recording') {
      recorder.current.stop()
    }

    stream.current?.getTracks().forEach(track => track.stop())
    stream.current = null

    Object.values(entries).forEach(entry => {
      if (entry.audioUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(entry.audioUrl)
      }
    })

    if (audioRef.current) {
      audioRef.current.pause()
    }

    sessionStorage.removeItem('memoni-access-key')

    setAuthenticated(false)
    setAccessKey('')
    setLoginKey('')
    setLoginError('')
    setSentences([])
    setEntries({})
    setCompleted([])
    setIndex(0)
    setPage('editor')
    setError('')
    setLoadError('')
    setPlaying(false)
    setRecording(false)
  }
  

  function updateEntryForSentence(
    sentenceId: number,
    patch: Partial<Entry>,
  ) {
    setEntries(previous => ({
      ...previous,
      [sentenceId]: {
        text: previous[sentenceId]?.text ?? '',
        audioUrl: previous[sentenceId]?.audioUrl ?? null,
        audioBlob: previous[sentenceId]?.audioBlob ?? null,
        ...patch,
      },
    }))
  }

  function updateEntry(patch: Partial<Entry>) {
  if (!sentence) return

  setError('')
  setSuccessMessage('')

  updateEntryForSentence(sentence.id, patch)
}

  async function startRecording() {
    setError('')

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError('Recording is not supported in this browser. Try Chrome or Safari.')
      return
    }

    const recordingSentenceId = sentence.id

    try {
      const audioStream =
        await navigator.mediaDevices.getUserMedia({ audio: true })

      stream.current = audioStream
      chunks.current = []

      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/webm',
      ].find(type => MediaRecorder.isTypeSupported(type))

      const mediaRecorder = new MediaRecorder(
        audioStream,
        mimeType ? { mimeType } : undefined,
      )

      recorder.current = mediaRecorder

      mediaRecorder.ondataavailable = event => {
        if (event.data.size > 0) {
          chunks.current.push(event.data)
        }
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks.current, {
          type: mediaRecorder.mimeType || 'audio/webm',
        })

        const url = URL.createObjectURL(blob)

        updateEntryForSentence(recordingSentenceId, {
          audioUrl: url,
          audioBlob: blob,
        })

        audioStream.getTracks().forEach(track => track.stop())
        stream.current = null
        setRecording(false)
      }

      mediaRecorder.start()
      setRecording(true)
    } catch (err) {
      console.error(err)
      setError('Microphone access was denied or unavailable.')
    }
  }

  function stopRecording() {
    if (recorder.current?.state === 'recording') {
      recorder.current.stop()
    } else {
      setRecording(false)
    }
  }

  function uploadAudio(file?: File) {
    if (!file) return

    if (!file.type.startsWith('audio/')) {
      setError('Please choose an audio file.')
      return
    }

    if (file.size > 15 * 1024 * 1024) {
      setError('The audio file must be smaller than 15 MB.')
      return
    }

    setError('')

    if (entry.audioUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(entry.audioUrl)
    }

    updateEntry({
      audioUrl: URL.createObjectURL(file),
      audioBlob: file,
    })
  }

  async function submitEntry() {
    if (!ready || !entry.audioBlob) {
      setError('Add the Memoni text and an audio recording first.')
      return
    }

    if (done) {
      setError(
        'This sentence has already been submitted. Editing existing submissions requires a backend update endpoint.',
      )
      return
    }

    setSaving(true)
    setError('')

    try {
      const formData = new FormData()
      formData.append('sentenceId', String(sentence.id))
      formData.append('romanizedMemoni', entry.text.trim())

      const extension = entry.audioBlob.type.includes('mp4')
        ? 'm4a'
        : entry.audioBlob.type.includes('ogg')
          ? 'ogg'
          : entry.audioBlob.type.includes('mpeg')
            ? 'mp3'
            : 'webm'

      formData.append(
        'audio',
        entry.audioBlob,
        `sentence-${sentence.id}.${extension}`,
      )

      const response = await fetch(`${API_URL}/api/submissions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessKey}`,
        },
        body: formData,
      })

      const result = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(
          result.error || `Submission failed (${response.status}).`,
        )
      }

      const nextCompleted = [...completed, sentence.id]
      setCompleted(nextCompleted)
      setCompletedTotal(previous => previous + 1)
      setPlaying(false)

      if (audioRef.current) {
        audioRef.current.pause()
      }

      const nextIndex = sentences.findIndex(
        item => !nextCompleted.includes(item.id),
      )

      if (nextIndex >= 0) {
        setIndex(nextIndex)
      } else {
        setPage('browser')
      }
    } catch (err) {
      console.error('Submission failed:', err)
      setError(
        err instanceof Error
          ? err.message
          : 'Could not save your submission.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function updateEntrySubmission() {
    if (!sentence?.submissionId || !entry.text.trim()) {
      setError('Could not identify this existing submission.')
      return
    }

    setSaving(true)
    setError('')
    setSuccessMessage('')

    try {
      const formData = new FormData()
      formData.append('romanizedMemoni', entry.text.trim())

      // Only attach audio if a replacement was recorded or uploaded.
      if (entry.audioBlob) {
        const extension = entry.audioBlob.type.includes('mp4')
          ? 'm4a'
          : entry.audioBlob.type.includes('ogg')
            ? 'ogg'
            : entry.audioBlob.type.includes('mpeg')
              ? 'mp3'
              : 'webm'

        formData.append(
          'audio',
          entry.audioBlob,
          `sentence-${sentence.id}.${extension}`,
        )
      }

      const response = await fetch(
        `${API_URL}/api/submissions/${encodeURIComponent(sentence.submissionId)}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessKey}`,
          },
          body: formData,
        },
      )

      const result = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(
          result.error || `Update failed (${response.status}).`,
        )
      }

      setSuccessMessage('Your contribution has been updated successfully.')
    } catch (err) {
      console.error('Update failed:', err)
      setError(
        err instanceof Error
          ? err.message
          : 'Could not update your contribution.',
      )
    } finally {
      setSaving(false)
    }
  }

  function goToSentence(sentenceIndex: number) {
    if (recording) {
      stopRecording()
    }

    if (audioRef.current) {
      audioRef.current.pause()
    }

    setIndex(sentenceIndex)
    setError('')
    setPlaying(false)
    setPage('editor')
  }

  async function navigateSentence(direction: 'previous' | 'next') {
    if (recording || loadingSentences) return

    const nextIndex = direction === 'next' ? index + 1 : index - 1

    // The sentence is on the currently loaded page.
    if (nextIndex >= 0 && nextIndex < sentences.length) {
      goToSentence(nextIndex)
      return
    }

    // Determine whether another page exists.
    const totalPages = Math.ceil(assignedTotal / PAGE_SIZE)

    const nextPage =
      direction === 'next' ? sentencePage + 1 : sentencePage - 1

    if (nextPage < 1 || nextPage > totalPages) return

    setLoadingSentences(true)
    setError('')

    try {
      const result = await fetchAssignedSentences(accessKey, nextPage)

      const loadedSentences: Sentence[] = result.sentences.map(item => ({
        id: item.id,
        urdu: item.source_urdu,
        position: item.position,
        submissionId: item.submission_id ?? null,
      }))

      applySentencePage(result)

      // Go to the first sentence on the next page,
      // or the last sentence on the previous page.
      setIndex(direction === 'next' ? 0 : loadedSentences.length - 1)
      setPage('editor')
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not load the next sentence.',
      )
    } finally {
      setLoadingSentences(false)
    }
  }

  const sentence = sentences[index]
  const entry: Entry = sentence
    ? entries[sentence.id] ?? {
      text: '',
      audioUrl: null,
      audioBlob: null,
    }
    : {
      text: '',
      audioUrl: null,
      audioBlob: null,
    }

  const done = sentence ? completed.includes(sentence.id) : false
  const ready = entry.text.trim().length > 0 && Boolean(entry.audioUrl)

  const completedCount = completedTotal;
  const pendingCount = assignedTotal - completedCount;

  const progress = assignedTotal > 0
    ? Math.round((completedCount / assignedTotal) * 100)
    : 0;

  const pageCompletedCount = sentences.filter(item =>
    completed.includes(item.id)
  ).length

  const pagePendingCount = sentences.length - pageCompletedCount

  const filteredSentences = sentences.filter(item => {
    const isDone = completed.includes(item.id)

    if (filter === 'pending' && isDone) return false
    if (filter === 'completed' && !isDone) return false

    const query = search.trim().toLowerCase()

    if (!query) return true

    return (
      String(item.position).includes(query) ||
      String(item.id).includes(query) ||
      item.urdu.toLowerCase().includes(query)
    )
  })

  // Loading screen.
  if (loadingSentences) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f8f7f3] px-6 text-[#29251f]">
        <div className="text-center">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#345b43] text-white">
            <Volume2 size={26} />
          </span>
          <p className="text-lg font-semibold">Memoni Voices</p>
          <p className="mt-2 text-sm text-stone-500">
            Loading your sentences...
          </p>
        </div>
      </main>
    )
  }

  // Login screen.
  if (!authenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f8f7f3] px-6 text-[#29251f]">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-7 shadow-sm"
        >
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#345b43] text-white">
            <Volume2 size={24} />
          </div>

          <h1 className="text-2xl font-semibold">Memoni Voices</h1>
          <p className="mt-2 text-sm leading-relaxed text-stone-500">
            Enter your volunteer password to access your assigned sentences.
          </p>

          <label htmlFor="access-key" className="mt-6 block text-sm font-medium">
            Volunteer password
          </label>

          <input
            id="access-key"
            type="password"
            autoComplete="current-password"
            value={loginKey}
            onChange={event => setLoginKey(event.target.value)}
            required
            className="mt-2 w-full rounded-xl border border-stone-200 px-4 py-3 outline-none focus:border-[#477653] focus:ring-4 focus:ring-[#477653]/10"
            placeholder="Enter your password"
          />

          {(loginError || loadError) && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {loginError || loadError}
            </p>
          )}

          <button
            type="submit"
            disabled={!loginKey.trim()}
            className="mt-5 w-full rounded-xl bg-[#345b43] px-5 py-3 font-semibold text-white hover:bg-[#284834] disabled:opacity-50"
          >
            Sign in
          </button>
        </form>
      </main>
    )
  }

  // Authenticated but no assignments or loading error.
  if (loadError || sentences.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f8f7f3] px-6 text-[#29251f]">
        <div className="max-w-md rounded-3xl border border-stone-200 bg-white p-7 text-center shadow-sm">
          <Volume2 size={28} className="mx-auto mb-4 text-[#345b43]" />
          <h1 className="text-xl font-semibold">Memoni Voices</h1>
          <p className="mt-3 text-sm text-stone-600">
            {loadError || 'No sentences were assigned to this account.'}
          </p>
          <button
            onClick={handleLogout}
            className="mt-5 rounded-xl bg-[#345b43] px-5 py-3 text-sm font-semibold text-white"
          >
            Back to login
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#f8f7f3] px-4 pb-10 text-[#29251f] sm:px-6">
      {/* Header */}
      <header className="mx-auto flex max-w-3xl items-center justify-between py-5">
        <button
          onClick={() => setPage('editor')}
          className="flex items-center gap-3 text-left"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#345b43] text-white">
            <Volume2 size={21} />
          </span>

          <span>
            <span className="block text-sm font-bold tracking-tight">
              Memoni Voices
            </span>
            <span className="block text-xs text-stone-500">
              Community language project
            </span>
          </span>
        </button>

        <button
          onClick={handleLogout}
          className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
        >
          <LogOut size={16} />
          <span className="hidden sm:inline">Log out</span>
        </button>
      </header>

      <section className="mx-auto max-w-3xl">
        {/* Navigation */}
        <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl border border-stone-200 bg-white p-2">
          <button
            onClick={() => setPage('editor')}
            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition ${page === 'editor'
                ? 'bg-[#345b43] text-white'
                : 'text-stone-600 hover:bg-stone-50'
              }`}
          >
            <Mic size={17} />
            Contribute
          </button>

          <button
            onClick={() => setPage('browser')}
            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition ${page === 'browser'
                ? 'bg-[#345b43] text-white'
                : 'text-stone-600 hover:bg-stone-50'
              }`}
          >
            <ListChecks size={17} />
            My sentences
          </button>
        </div>

        {/* Progress summary */}
        <div className="mb-6 rounded-2xl border border-stone-200 bg-white p-5">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-stone-500">
                Your contribution
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {completedCount.toLocaleString()} / {assignedTotal.toLocaleString()}
              </p>
            </div>
            <span className="text-sm font-semibold text-[#345b43]">
              {progress}%
            </span>
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-stone-200">
            <div
              className="h-full rounded-full bg-[#477653] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="mt-3 flex justify-between text-xs text-stone-500">
            <span>{completedCount.toLocaleString()} completed</span>
            <span>{pendingCount.toLocaleString()} pending</span>
          </div>
        </div>

        {/* Sentence browser */}
        {page === 'browser' && (
          <div>
            <div className="mb-5">
              <h1 className="text-2xl font-semibold tracking-tight">
                Your sentences
              </h1>
              <p className="mt-1 text-sm text-stone-500">
                Select any assigned sentence to open it.
              </p>
              {/* Pagination */}
              <div className="mt-4 flex items-center justify-between rounded-2xl border border-stone-200 bg-white p-4">
                <button
                  onClick={() => void navigateSentence('previous')}
                  disabled={
                    (sentencePage === 1 && index === 0) ||
                    recording ||
                    loadingSentences
                  }
                  className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-stone-200 px-4 py-3 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                >
                  <ArrowLeft size={17} />
                  Previous
                </button>

                <div className="text-center">
                  <p className="text-sm font-semibold">
                    Page {sentencePage} of {Math.ceil(assignedTotal / PAGE_SIZE)}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    Showing {Math.min((sentencePage - 1) * PAGE_SIZE + 1, assignedTotal)}
                    {'–'}
                    {Math.min(sentencePage * PAGE_SIZE, assignedTotal)}
                    {' of '}
                    {assignedTotal.toLocaleString()}
                  </p>
                </div>

                <button
                  onClick={() => changeSentencePage(sentencePage + 1)}
                  disabled={
                    sentencePage >= Math.ceil(assignedTotal / PAGE_SIZE) ||
                    loadingSentences
                  }
                  className="flex items-center gap-2 rounded-xl bg-[#345b43] px-4 py-2 text-sm font-medium text-white hover:bg-[#284834] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="relative mb-4">
              <Search
                size={18}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400"
              />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search by sentence number or Urdu text..."
                className="w-full rounded-xl border border-stone-200 bg-white py-3 pl-11 pr-4 text-sm outline-none focus:border-[#477653] focus:ring-4 focus:ring-[#477653]/10"
              />
            </div>

            {/* Filters */}
            <div className="mb-4 flex gap-2 overflow-x-auto">
              {([
                ['all', `All (${sentences.length})`],
                ['pending', `Pending (${pagePendingCount})`],
                ['completed', `Completed (${pageCompletedCount})`],
              ] as [Filter, string][]).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold transition ${filter === value
                      ? 'bg-[#345b43] text-white'
                      : 'border border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
                    }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Checklist */}
            <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
              <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
                <span className="text-sm font-semibold">
                  Sentence checklist
                </span>
                <span className="text-xs text-stone-500">
                  {filteredSentences.length.toLocaleString()} results
                </span>
              </div>

              <div className="divide-y divide-stone-100">
                {filteredSentences.length === 0 ? (
                  <div className="p-8 text-center text-sm text-stone-500">
                    No sentences found.
                  </div>
                ) : (
                  filteredSentences.map(item => {
                    const isDone = completed.includes(item.id)
                    const sentenceIndex = sentences.findIndex(
                      sentence => sentence.id === item.id,
                    )

                    return (
                      <button
                        key={item.id}
                        onClick={() => goToSentence(sentenceIndex)}
                        className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-[#f8f7f3]"
                      >
                        {isDone ? (
                          <CheckCircle2
                            size={21}
                            className="shrink-0 text-[#477653]"
                          />
                        ) : (
                          <Circle
                            size={21}
                            className="shrink-0 text-stone-300"
                          />
                        )}

                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-stone-500">
                            Sentence {item.position}
                          </p>
                          <p
                            lang="ur"
                            dir="rtl"
                            className="mt-1 truncate text-lg"
                          >
                            {item.urdu}
                          </p>
                        </div>

                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${isDone
                              ? 'bg-[#e5ecdf] text-[#345b43]'
                              : 'bg-stone-100 text-stone-500'
                            }`}
                        >
                          {isDone ? 'Done' : 'Pending'}
                        </span>

                        <ArrowRight
                          size={16}
                          className="shrink-0 text-stone-400"
                        />
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* Sentence editor */}
        {page === 'editor' && sentence && (
          <div>
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="mb-1 text-sm text-stone-500">
                  Sentence {sentence.position} of {assignedTotal}
                </p>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  Help preserve Memoni.
                </h1>
              </div>

              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#e5ecdf] text-[#345b43]">
                <Heart size={22} />
              </span>
            </div>

            <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-7">
              <div className="mb-5 flex items-center justify-between">
                <span className="rounded-full bg-stone-100 px-3 py-1.5 text-xs font-medium text-stone-600">
                  Translate into Memoni
                </span>

                {done && (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-[#345b43]">
                    <Check size={14} />
                    Submitted
                  </span>
                )}
              </div>

              <p className="mb-3 text-xs font-medium uppercase tracking-widest text-stone-400">
                Urdu sentence
              </p>

              <div
                lang="ur"
                dir="rtl"
                className="rounded-2xl bg-[#f7f6f1] px-4 py-7 text-center text-3xl leading-relaxed sm:px-6 sm:py-9 sm:text-4xl"
              >
                {sentence.urdu}
              </div>

              <div className="mb-2 mt-7 flex items-center justify-between">
                <label htmlFor="memoni-text" className="text-sm font-semibold">
                  Romanized Memoni
                </label>
                <span className="text-xs text-stone-400">Required</span>
              </div>

              <textarea
                id="memoni-text"
                value={entry.text}
                // readOnly={done}
                onChange={event =>
                  updateEntry({ text: event.target.value })
                }
                placeholder="Type the Memoni translation using Roman letters..."
                rows={3}
                className="w-full resize-y rounded-2xl border border-stone-200 bg-white p-4 text-base outline-none transition placeholder:text-stone-400 focus:border-[#477653] focus:ring-4 focus:ring-[#477653]/10 read-only:bg-stone-50"
              />

              <p className="mt-2 text-xs leading-relaxed text-stone-500">
                Write the sentence as it is naturally spoken. Use the same
                Romanization style consistently.
              </p>

              {done && (
                <div className="mt-5 rounded-xl border border-[#cdddc8] bg-[#edf3e9] p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-[#345b43]">
                    <CheckCircle2 size={17} />
                    Previously submitted contribution
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-stone-600">
                    You can edit your translation below. Your existing audio recording
                    will be kept unless you record or upload a replacement.
                  </p>
                </div>
              )}
              {(
                <>
                  <div className="mb-3 mt-8 flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-semibold">Voice recording</h2>
                      <p className="mt-1 text-xs text-stone-500">
                        Speak the Memoni translation naturally.
                      </p>
                    </div>

                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f0f2e9] text-[#345b43]">
                      <Mic size={18} />
                    </span>
                  </div>

                  <div className="rounded-2xl border border-dashed border-stone-300 bg-[#faf9f6] p-4 sm:p-5">
                    {entry.audioUrl ? (
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => {
                            if (!audioRef.current) return

                            if (playing) {
                              audioRef.current.pause()
                              setPlaying(false)
                            } else {
                              void audioRef.current.play()
                                .then(() => setPlaying(true))
                                .catch(() => {
                                  setError('Could not play this recording.')
                                })
                            }
                          }}
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#345b43] text-white"
                          aria-label={playing ? 'Pause recording' : 'Play recording'}
                        >
                          {playing ? <Pause size={20} /> : <Play size={20} />}
                        </button>

                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">Recording ready</p>
                          <p className="mt-1 text-xs text-stone-500">
                            Listen before submitting.
                          </p>
                          <audio
                            ref={audioRef}
                            src={entry.audioUrl}
                            onEnded={() => setPlaying(false)}
                            onPause={() => setPlaying(false)}
                            className="hidden"
                          />
                        </div>

                        <button
                          onClick={() => {
                            audioRef.current?.pause()

                            if (entry.audioUrl?.startsWith('blob:')) {
                              URL.revokeObjectURL(entry.audioUrl)
                            }

                            setPlaying(false)
                            updateEntry({
                              audioUrl: null,
                              audioBlob: null,
                            })
                          }}
                          className="flex h-10 w-10 items-center justify-center rounded-xl text-stone-500 hover:bg-stone-200"
                          aria-label="Remove recording"
                        >
                          <X size={18} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center py-2 text-center">
                        <span
                          className={`mb-3 flex h-14 w-14 items-center justify-center rounded-full ${recording
                              ? 'animate-pulse bg-red-100 text-red-600'
                              : 'bg-[#e5ecdf] text-[#345b43]'
                            }`}
                        >
                          {recording ? (
                            <span className="h-4 w-4 rounded-full bg-red-500" />
                          ) : (
                            <Mic size={24} />
                          )}
                        </span>

                        <p className="text-sm font-medium">
                          {recording ? 'Recording in progress…' : 'Record your voice'}
                        </p>

                        <p className="mt-1 text-xs text-stone-500">
                          {recording
                            ? 'Tap stop when you have finished speaking.'
                            : 'Allow microphone access when prompted.'}
                        </p>

                        <button
                          onClick={recording ? stopRecording : startRecording}
                          className={`mt-4 flex min-h-12 items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white ${recording
                              ? 'bg-red-600 hover:bg-red-700'
                              : 'bg-[#345b43] hover:bg-[#284834]'
                            }`}
                        >
                          {recording ? (
                            <>
                              <Square size={16} />
                              Stop recording
                            </>
                          ) : (
                            <>
                              <Mic size={17} />
                              Start recording
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    <div className="my-4 border-t border-stone-200" />

                    <button
                      onClick={() => fileRef.current?.click()}
                      disabled={recording}
                      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                    >
                      <FileAudio size={17} />
                      Upload an audio file instead
                    </button>

                    <input
                      ref={fileRef}
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={event => {
                        uploadAudio(event.target.files?.[0])
                        event.target.value = ''
                      }}
                    />
                  </div>
                </>
              )}

              {error && (
                <div
                  role="alert"
                  className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                >
                  {error}
                </div>
              )}
              {successMessage && (
                <div className="mt-4 rounded-xl border border-[#cdddc8] bg-[#edf3e9] p-3 text-sm text-[#345b43]">
                  {successMessage}
                </div>
              )}

              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                <button
                  onClick={() => goToSentence(Math.max(0, index - 1))}
                  disabled={index === 0 || recording}
                  className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-stone-200 px-4 py-3 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                >
                  <ArrowLeft size={17} />
                  Previous
                </button>

                {/* <button
                  onClick={() => setPage('browser')}
                  className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-stone-200 px-4 py-3 text-sm font-medium text-stone-700 hover:bg-stone-50"
                >
                  <ListChecks size={17} />
                  Browse sentences
                </button> */}

                

                {done ? (
                  <button
                    onClick={updateEntrySubmission}
                    disabled={!entry.text.trim() || !sentence.submissionId || recording || saving}
                    className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#345b43] px-5 py-3 text-sm font-semibold text-white hover:bg-[#284834] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? 'Updating...' : 'Update contribution'}
                    <Check size={17} />
                  </button>
                ) : (
                  <button
                    onClick={submitEntry}
                    disabled={!ready || recording || saving}
                    className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#345b43] px-5 py-3 text-sm font-semibold text-white hover:bg-[#284834] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save & continue'}
                    <ArrowRight size={17} />
                  </button>
                )}
                <button
                  onClick={() => void navigateSentence('next')}
                  disabled={
                    (sentencePage === Math.ceil(assignedTotal / PAGE_SIZE) &&
                      index === sentences.length - 1) ||
                    recording ||
                    loadingSentences
                  }
                  className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-stone-200 px-4 py-3 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                >
                  Next
                  <ArrowRight size={17} />
                </button>
              </div>
            </div>

            { assignedTotal > 0 && completedCount === assignedTotal &&  (
              <div className="mt-5 rounded-2xl border border-[#cdddc8] bg-[#edf3e9] p-5 text-center">
                <Check size={26} className="mx-auto mb-2 text-[#345b43]" />
                <h2 className="font-semibold">All sentences completed!</h2>
                <p className="mt-1 text-sm text-stone-600">
                  Thank you for contributing to Memoni Voices.
                </p>
                <button
                  onClick={() => setPage('browser')}
                  className="mt-4 rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-medium"
                >
                  View checklist
                </button>
              </div>
            )}
          </div>
        )}

        <p className="mt-6 flex items-start justify-center gap-2 px-2 text-center text-xs leading-relaxed text-stone-500">
          <CircleHelp size={15} className="mt-0.5 shrink-0" />
          Your submissions are saved to the project database when you select
          Save &amp; continue.
        </p>
      </section>
    </main>
  )
}
