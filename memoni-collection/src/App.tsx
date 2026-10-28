
import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Check, CircleHelp, FileAudio,
  Headphones, Mic, Pause, Play, RotateCcw, ShieldCheck,
  Square, Volume2, X,
} from 'lucide-react'

type Sentence = { id: number; urdu: string }
type Entry = { text: string; audioUrl: string | null }

const sentences: Sentence[] = [
  { id: 1, urdu: 'آپ کا نام کیا ہے؟' },
  { id: 2, urdu: 'آپ کیسے ہیں؟' },
  { id: 3, urdu: 'آج موسم بہت اچھا ہے۔' },
  { id: 4, urdu: 'کیا آپ میری مدد کر سکتے ہیں؟' },
  { id: 5, urdu: 'مجھے پانی چاہیے۔' },
]

export default function App() {
  const [index, setIndex] = useState(0)
  const [entries, setEntries] = useState<Record<number, Entry>>({})
  const [completed, setCompleted] = useState<number[]>([])
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)

  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<BlobPart[]>([])
  const stream = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const sentence = sentences[index]
  const entry = entries[sentence.id] ?? { text: '', audioUrl: null }
  const done = completed.includes(sentence.id)
  const ready = entry.text.trim().length > 0 && !!entry.audioUrl

  useEffect(() => {
    return () => {
      stream.current?.getTracks().forEach(track => track.stop())
      Object.values(entries).forEach(item => {
        if (item.audioUrl?.startsWith('blob:')) URL.revokeObjectURL(item.audioUrl)
      })
    }
  }, [])

  function updateEntry(patch: Partial<Entry>) {
    setEntries(previous => ({
      ...previous,
      [sentence.id]: { ...entry, ...patch },
    }))
  }

  async function startRecording() {
    setError('')

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError('Recording is not supported in this browser. Try a recent version of Safari or Chrome, or upload an audio file.')
      return
    }

    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true })
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
        if (event.data.size > 0) chunks.current.push(event.data)
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks.current, {
          type: mediaRecorder.mimeType || 'audio/webm',
        })
        const url = URL.createObjectURL(blob)
        updateEntry({ audioUrl: url })
        audioStream.getTracks().forEach(track => track.stop())
        stream.current = null
      }

      mediaRecorder.start()
      setRecording(true)
    } catch {
      setError('Microphone access was denied or unavailable. Allow microphone access or upload an audio file instead.')
    }
  }

  function stopRecording() {
    if (recorder.current?.state === 'recording') {
      recorder.current.stop()
    }
    setRecording(false)
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
    updateEntry({ audioUrl: URL.createObjectURL(file) })
  }

  function submitEntry() {
    if (!ready) {
      setError('Add the Romanized Memoni text and an audio recording before continuing.')
      return
    }

    setCompleted(previous =>
      previous.includes(sentence.id) ? previous : [...previous, sentence.id],
    )
    setError('')

    if (index < sentences.length - 1) {
      setIndex(index + 1)
      setPlaying(false)
    }
  }

  function goTo(nextIndex: number) {
    if (recording) stopRecording()
    setIndex(nextIndex)
    setError('')
    setPlaying(false)
  }

  const progress = Math.round((completed.length / sentences.length) * 100)

  return (
    <main className="min-h-screen bg-[#f8f7f3] px-4 pb-10 text-[#29251f] sm:px-6">
      <header className="mx-auto flex max-w-3xl items-center justify-between py-5">
        <a href="#" className="flex items-center gap-3 no-underline text-inherit">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#345b43] text-white">
            <Volume2 size={21} />
          </span>
          <span>
            <span className="block text-sm font-bold tracking-tight">Memoni Voices</span>
            <span className="block text-xs text-stone-500">Community language project</span>
          </span>
        </a>
        <span className="hidden items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-2 text-xs text-stone-600 sm:flex">
          <ShieldCheck size={15} /> Collection preview
        </span>
      </header>

      <section className="mx-auto max-w-2xl">
        <div className="mb-7 mt-5">
          <div className="mb-3 flex items-center justify-between text-xs font-medium text-stone-500">
            <span>YOUR CONTRIBUTION</span>
            <span>{completed.length} of {sentences.length} completed</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-stone-200">
            <div
              className="h-full rounded-full bg-[#477653] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="mb-1 text-sm text-stone-500">Sentence {index + 1} of {sentences.length}</p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Help preserve Memoni.
            </h1>
          </div>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#e5ecdf] text-[#345b43]">
            <Headphones size={22} />
          </span>
        </div>

        <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-5 flex items-center justify-between">
            <span className="rounded-full bg-stone-100 px-3 py-1.5 text-xs font-medium text-stone-600">
              Translate into Memoni
            </span>
            <span className="text-xs text-stone-400">Source: Urdu</span>
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
            onChange={event => updateEntry({ text: event.target.value })}
            placeholder="Type the Memoni translation using Roman letters..."
            rows={3}
            className="w-full resize-y rounded-2xl border border-stone-200 bg-white p-4 text-base outline-none transition placeholder:text-stone-400 focus:border-[#477653] focus:ring-4 focus:ring-[#477653]/10"
          />
          <p className="mt-2 text-xs leading-relaxed text-stone-500">
            Write the sentence as it is naturally spoken. Use the same Romanization style consistently.
          </p>

          <div className="mb-3 mt-8 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Voice recording</h2>
              <p className="mt-1 text-xs text-stone-500">Speak the Memoni translation naturally.</p>
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
                      setPlaying(true)
                    }
                  }}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#345b43] text-white"
                  aria-label={playing ? 'Pause recording' : 'Play recording'}
                >
                  {playing ? <Pause size={20} /> : <Play size={20} />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Recording ready</p>
                  <p className="mt-1 text-xs text-stone-500">Listen before submitting.</p>
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
                    setPlaying(false)
                    updateEntry({ audioUrl: null })
                  }}
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-stone-500 hover:bg-stone-200"
                  aria-label="Remove recording"
                >
                  <X size={18} />
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center py-2 text-center">
                <span className={`mb-3 flex h-14 w-14 items-center justify-center rounded-full ${recording ? 'animate-pulse bg-red-100 text-red-600' : 'bg-[#e5ecdf] text-[#345b43]'}`}>
                  {recording ? <span className="h-4 w-4 rounded-full bg-red-500" /> : <Mic size={24} />}
                </span>
                <p className="text-sm font-medium">
                  {recording ? 'Recording in progress…' : 'Record your voice'}
                </p>
                <p className="mt-1 text-xs text-stone-500">
                  {recording ? 'Tap stop when you have finished speaking.' : 'Allow microphone access when prompted.'}
                </p>
                <button
                  onClick={recording ? stopRecording : startRecording}
                  className={`mt-4 flex min-h-12 items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white transition active:scale-[0.98] ${recording ? 'bg-red-600 hover:bg-red-700' : 'bg-[#345b43] hover:bg-[#284834]'}`}
                >
                  {recording ? <><Square size={16} /> Stop recording</> : <><Mic size={17} /> Start recording</>}
                </button>
              </div>
            )}

            <div className="my-4 border-t border-stone-200" />

            <button
              onClick={() => fileRef.current?.click()}
              disabled={recording}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              <FileAudio size={17} /> Upload an audio file instead
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

          {error && (
            <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-relaxed text-red-700">
              {error}
            </div>
          )}

          {done && (
            <p className="mt-4 flex items-center gap-2 text-sm font-medium text-[#345b43]">
              <Check size={17} /> Completed in this session
            </p>
          )}

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <button
              onClick={() => goTo(Math.max(0, index - 1))}
              disabled={index === 0}
              className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-stone-200 px-4 py-3 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              <ArrowLeft size={17} /> Previous
            </button>
            <button
              onClick={submitEntry}
              disabled={!ready}
              className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#345b43] px-5 py-3 text-sm font-semibold text-white hover:bg-[#284834]"
            >
              {index === sentences.length - 1 ? 'Complete batch' : 'Save & continue'}
              <ArrowRight size={17} />
            </button>
          </div>
        </div>

        {completed.length === sentences.length && (
          <div className="mt-5 rounded-2xl border border-[#cdddc8] bg-[#edf3e9] p-5 text-center">
            <Check size={26} className="mx-auto mb-2 text-[#345b43]" />
            <h2 className="font-semibold">Demo batch completed!</h2>
            <p className="mt-1 text-sm leading-relaxed text-stone-600">
              This is only a local prototype. Your entries have not been uploaded or permanently saved.
            </p>
            <button
              onClick={() => {
                setIndex(0)
                setCompleted([])
                setEntries({})
                setError('')
              }}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-medium"
            >
              <RotateCcw size={16} /> Reset demo
            </button>
          </div>
        )}

        <p className="mt-6 flex items-start justify-center gap-2 px-2 text-center text-xs leading-relaxed text-stone-500">
          <CircleHelp size={15} className="mt-0.5 shrink-0" />
          Prototype only. No account, permanent storage, or dataset upload is connected yet.
        </p>
      </section>
    </main>
  )
}
