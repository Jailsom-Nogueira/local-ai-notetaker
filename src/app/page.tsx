'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  buildSharePayload,
  buildShareUrl,
  formatShareMessage,
  isLongSharePayload,
  type ShareChannel,
  type ShareSection,
} from '@/lib/share';

type WhisperSegment = { start: number; end: number; text: string };
type AiReview = {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  decisions: string[];
  questions: string[];
  topics: string[];
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  generatedAt: string;
  model: string;
};
type Recording = {
  id: string;
  createdAt: string;
  durationSec: number;
  title: string;
  sources: string[];
  transcript: string;
  segments: WhisperSegment[];
  language?: string;
  review?: AiReview | null;
};

type LanguageCode = 'auto' | 'en' | 'pt' | 'es';

const LANGUAGE_OPTIONS: ReadonlyArray<{ code: LanguageCode; label: string; flag: string }> = [
  { code: 'auto', label: 'Auto-detect', flag: '🌐' },
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'pt', label: 'Português', flag: '🇧🇷' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatHMS(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
function formatRelative(iso: string) {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}
function sentimentBadge(s: AiReview['sentiment']) {
  switch (s) {
    case 'positive': return 'badge badge-success';
    case 'negative': return 'badge badge-danger';
    case 'mixed':    return 'badge badge-purple';
    default:         return 'badge badge-neutral';
  }
}
function languageFlag(code: string): string {
  const m: Record<string, string> = {
    en: '🇺🇸', pt: '🇧🇷', es: '🇪🇸', fr: '🇫🇷',
    de: '🇩🇪', it: '🇮🇹', ja: '🇯🇵', zh: '🇨🇳',
  };
  return m[code] || '🌐';
}

export default function HomePage() {
  // recorder state
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [meterLevel, setMeterLevel] = useState(0);
  const [useMic, setUseMic] = useState(true);
  const [useSystem, setUseSystem] = useState(false);
  // High sensitivity for ambient/room recording. Defaults to 3× gain with no noise gating.
  const [sensitivity, setSensitivity] = useState(3); // 1..8 multiplier
  const [highSensitivity, setHighSensitivity] = useState(true); // disables NS/AGC/EC for ambient pickup
  // Language: 'auto' (Whisper detects) | 'en' | 'pt' | 'es' | ...
  const [language, setLanguage] = useState<LanguageCode>('auto');
  const [processing, setProcessing] = useState<'idle' | 'transcribing' | 'reviewing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [hostLabel, setHostLabel] = useState('local app');

  // history
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = recordings.find(r => r.id === selectedId) || null;
  const selectedHasReview = Boolean(selected?.review);
  const [shareSections, setShareSections] = useState<ShareSection[]>(['transcript', 'review']);
  const [shareNotice, setShareNotice] = useState<string | null>(null);

  // refs for recorder pipeline
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamsRef = useRef<MediaStream[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const meterRafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const elapsedTimerRef = useRef<number | null>(null);

  const loadRecordings = useCallback(async () => {
    try {
      const r = await fetch('/api/recordings');
      const j = await r.json();
      if (j.ok) setRecordings(j.recordings);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadRecordings(); }, [loadRecordings]);
  useEffect(() => { setHostLabel(window.location.host); }, []);
  useEffect(() => {
    setShareNotice(null);
    setShareSections(selectedHasReview ? ['transcript', 'review'] : ['transcript']);
  }, [selectedId, selectedHasReview]);

  /** Build a combined audio stream from chosen sources, with software gain for ambient pickup. */
  async function buildStream(): Promise<{ stream: MediaStream; usedSources: string[] }> {
    const sources: MediaStream[] = [];
    const usedSources: string[] = [];

    if (useMic) {
      // High-sensitivity mode: disable browser DSP that aggressively suppresses
      // distant/ambient voices. Keep them on only if the user wants close-talk cleanup.
      const micConstraints: MediaTrackConstraints = highSensitivity
        ? ({
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            sampleRate: 48000,
            channelCount: 1,
            googEchoCancellation: false,
            googAutoGainControl: false,
            googNoiseSuppression: false,
            googHighpassFilter: false,
            googTypingNoiseDetection: false,
          } as MediaTrackConstraints)
        : {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          };
      const mic = await navigator.mediaDevices.getUserMedia({ audio: micConstraints });
      sources.push(mic);
      usedSources.push('mic');
    }

    if (useSystem) {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      display.getVideoTracks().forEach((t: MediaStreamTrack) => t.stop());
      const audioTracks = display.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('No system audio captured. When sharing, check "Share tab audio" or "Share system audio".');
      }
      sources.push(new MediaStream(audioTracks));
      usedSources.push('system');
    }

    if (sources.length === 0) {
      throw new Error('Select at least one audio source (Microphone or System Audio).');
    }

    streamsRef.current = sources;

    // Always route through a WebAudio graph so we can apply software gain
    // (high sensitivity = boosting quiet ambient voices before MediaRecorder).
    const ctx = new AudioContext({ sampleRate: 48000 });
    audioCtxRef.current = ctx;

    const dest = ctx.createMediaStreamDestination();
    const gain = ctx.createGain();
    gain.gain.value = sensitivity;
    gainNodeRef.current = gain;

    // Soft-knee limiter so high gain doesn't clip when someone speaks loudly nearby.
    // Threshold -3dBFS, fast attack, gentle release.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;

    for (const s of sources) {
      const node = ctx.createMediaStreamSource(s);
      node.connect(gain);
    }
    gain.connect(limiter);
    limiter.connect(dest);

    return { stream: dest.stream, usedSources };
  }

  // Live-update gain when the slider moves during recording
  useEffect(() => {
    if (gainNodeRef.current && audioCtxRef.current) {
      gainNodeRef.current.gain.setTargetAtTime(
        sensitivity,
        audioCtxRef.current.currentTime,
        0.05
      );
    }
  }, [sensitivity]);

  function setupMeter(stream: MediaStream) {
    const ctx = audioCtxRef.current || new AudioContext();
    audioCtxRef.current = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    analyserRef.current = analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let max = 0;
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i] - 128);
        if (v > max) max = v;
      }
      setMeterLevel(Math.min(100, (max / 128) * 200));
      meterRafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }

  async function startRecording() {
    setError(null);
    try {
      const { stream, usedSources } = await buildStream();
      setupMeter(stream);

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';

      const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 192000 } : undefined);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };

      mr.onstop = async () => {
        cleanupStreams();
        const blob = new Blob(chunksRef.current, { type: mime || 'audio/webm' });
        const durationSec = (Date.now() - startTimeRef.current) / 1000;
        await uploadAndProcess(blob, usedSources, durationSec);
      };

      startTimeRef.current = Date.now();
      setElapsed(0);
      elapsedTimerRef.current = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 250);

      mr.start(1000); // 1s chunks
      setIsRecording(true);
    } catch (error) {
      setError(errorMessage(error));
      cleanupStreams();
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }

  function cleanupStreams() {
    if (meterRafRef.current) cancelAnimationFrame(meterRafRef.current);
    meterRafRef.current = null;
    streamsRef.current.forEach(s => s.getTracks().forEach(t => t.stop()));
    streamsRef.current = [];
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
    }
    setMeterLevel(0);
  }

  async function uploadAndProcess(blob: Blob, usedSources: string[], durationSec: number) {
    setProcessing('transcribing');
    setError(null);
    try {
      const fd = new FormData();
      fd.append('audio', blob, `recording.webm`);
      fd.append('sources', usedSources.join(','));
      fd.append('durationSec', String(Math.round(durationSec)));
      fd.append('language', language);
      const r = await fetch('/api/transcribe', { method: 'POST', body: fd });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Transcription failed');

      const rec: Recording = j.recording;
      setSelectedId(rec.id);
      await loadRecordings();

      // Auto-trigger AI review
      setProcessing('reviewing');
      const r2 = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rec.id }),
      });
      const j2 = await r2.json();
      if (!j2.ok) throw new Error(j2.error || 'AI review failed');
      await loadRecordings();
      setProcessing('idle');
    } catch (error) {
      setError(errorMessage(error));
      setProcessing('idle');
      await loadRecordings();
    }
  }

  async function rerunReview(id: string) {
    setProcessing('reviewing');
    setError(null);
    try {
      const r = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'AI review failed');
      await loadRecordings();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setProcessing('idle');
    }
  }

  async function deleteRecording(id: string) {
    if (!confirm('Delete this recording?')) return;
    await fetch(`/api/recordings/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (selectedId === id) setSelectedId(null);
    await loadRecordings();
  }

  function toggleShareSection(section: ShareSection) {
    if (!selected) return;
    if (section === 'review' && !selected.review) return;

    setShareNotice(null);
    setShareSections(current => {
      const available = current.filter(value => value === 'transcript' || Boolean(selected.review));
      if (current.includes(section)) {
        if (available.length <= 1) return current;
        return current.filter(value => value !== section);
      }
      return [...current, section];
    });
  }

  function announceShare(channel: ShareChannel) {
    setShareNotice(channel === 'email'
      ? 'Opening your email composer…'
      : 'Opening WhatsApp…');
  }

  async function copyShareText() {
    if (!sharePayload) return;
    try {
      await navigator.clipboard.writeText(formatShareMessage(sharePayload));
      setShareNotice('Share text copied. Paste it into email or WhatsApp.');
    } catch {
      setShareNotice('Copy failed. Use Email or WhatsApp to open a composer instead.');
    }
  }

  const totalNotes = recordings.length;
  const totalSeconds = recordings.reduce((a, r) => a + (r.durationSec || 0), 0);
  const totalActions = recordings.reduce((a, r) => a + (r.review?.actionItems?.length || 0), 0);
  const sharePayload = selected ? buildSharePayload(selected, shareSections) : null;
  const shareIsLong = sharePayload ? isLongSharePayload(sharePayload) : false;
  const shareSelectionLabel = sharePayload
    ? sharePayload.sections.map(section => section === 'review' ? 'AI Review' : 'Transcript').join(' + ')
    : '';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">N</div>
          <div className="brand-name">Notetaker</div>
        </div>
        <nav className="nav">
          <button className="nav-item active">⏺ Record</button>
          <button className="nav-item" onClick={() => setSelectedId(null)}>📋 Dashboard</button>
        </nav>
        <div className="sidebar-footer">
          Local · Whisper.cpp · OpenAI<br/>
          <code>{hostLabel}</code>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div>
            <h1>{selected ? selected.title : 'Record a note'}</h1>
            <p>{selected
              ? `${formatRelative(selected.createdAt)} · ${formatHMS(selected.durationSec)} · ${selected.sources.join(' + ') || 'mic'}${selected.language ? ' · ' + languageFlag(selected.language) + ' ' + selected.language.toUpperCase() : ''}`
              : 'Capture mic or system audio. Transcribed locally with Whisper, reviewed by AI.'}
            </p>
          </div>
          {selected && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => rerunReview(selected.id)} disabled={processing !== 'idle'}>
                {processing === 'reviewing' ? <><span className="spinner"/> Reviewing</> : '↻ Re-run review'}
              </button>
              <button className="btn btn-ghost" onClick={() => deleteRecording(selected.id)}>Delete</button>
            </div>
          )}
        </div>

        {error && <div className="error-banner">⚠ {error}</div>}
        {processing !== 'idle' && (
          <div className="processing-banner">
            <span className="spinner" />
            {processing === 'transcribing' && 'Transcribing audio with Whisper on your machine…'}
            {processing === 'reviewing' && 'Sending transcript text to OpenAI for review…'}
          </div>
        )}

        {!selected && (
          <>
            <div className="stats-grid">
              <div className="stat-tile">
                <div className="stat-tile-label">Notes</div>
                <div className="stat-tile-value">{totalNotes}</div>
              </div>
              <div className="stat-tile">
                <div className="stat-tile-label">Total recorded</div>
                <div className="stat-tile-value">{formatHMS(totalSeconds)}</div>
              </div>
              <div className="stat-tile">
                <div className="stat-tile-label">Action items extracted</div>
                <div className="stat-tile-value">{totalActions}</div>
              </div>
              <div className="stat-tile">
                <div className="stat-tile-label">Engine</div>
                <div className="stat-tile-value" style={{ fontSize: 18 }}>Whisper · OpenAI</div>
              </div>
            </div>

            <div className="recorder-card">
              <div className="recorder-status">
                {isRecording ? <><span className="record-pulse"/> Recording</> : 'Ready'}
              </div>
              <div className="recorder-time">{formatHMS(elapsed)}</div>
              <div className="recorder-meter">
                <div className="recorder-meter-fill" style={{ width: `${meterLevel}%` }} />
              </div>
              <div className="source-toggles">
                <button
                  className={`source-toggle ${useMic ? 'active' : ''}`}
                  onClick={() => !isRecording && setUseMic(v => !v)}
                  disabled={isRecording}
                >
                  <span className="dot" /> Microphone
                </button>
                <button
                  className={`source-toggle ${useSystem ? 'active' : ''}`}
                  onClick={() => !isRecording && setUseSystem(v => !v)}
                  disabled={isRecording}
                  title="Captures Zoom/Meet/tab audio via screen-share dialog"
                >
                  <span className="dot" /> System Audio
                </button>
                <button
                  className={`source-toggle ${highSensitivity ? 'active' : ''}`}
                  onClick={() => !isRecording && setHighSensitivity(v => !v)}
                  disabled={isRecording}
                  title="Disables echo cancellation, noise suppression, and auto gain control so distant/ambient voices come through. Recommended for room recording."
                >
                  <span className="dot" /> Ambient mode
                </button>
              </div>

              <div className="lang-picker">
                <span className="lang-picker-label">Language</span>
                <div className="lang-picker-options">
                  {LANGUAGE_OPTIONS.map(({ code, label, flag }) => (
                    <button
                      key={code}
                      className={`lang-option ${language === code ? 'active' : ''}`}
                      onClick={() => !isRecording && setLanguage(code)}
                      disabled={isRecording}
                      type="button"
                    >
                      <span className="lang-flag">{flag}</span> {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sensitivity-row">
                <label className="sensitivity-label">
                  Sensitivity
                  <span className="sensitivity-value">{sensitivity.toFixed(1)}×</span>
                </label>
                <input
                  type="range"
                  min={1}
                  max={8}
                  step={0.5}
                  value={sensitivity}
                  onChange={e => setSensitivity(Number(e.target.value))}
                  className="sensitivity-slider"
                />
                <div className="sensitivity-hint">
                  {sensitivity <= 1.5 && 'Close talk · normal voice'}
                  {sensitivity > 1.5 && sensitivity <= 3 && 'Room conversation · 1–2m'}
                  {sensitivity > 3 && sensitivity <= 5 && 'Far ambient · 2–4m'}
                  {sensitivity > 5 && 'Maximum · faint voices, may pick up background noise'}
                </div>
              </div>
              <div className="recorder-controls">
                {!isRecording ? (
                  <button
                    className="btn btn-primary btn-large"
                    onClick={startRecording}
                    disabled={processing !== 'idle'}
                  >
                    ⏺ Start recording
                  </button>
                ) : (
                  <button className="btn btn-danger btn-large" onClick={stopRecording}>
                    ⏹ Stop
                  </button>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-body)', textAlign: 'center', maxWidth: 480 }}>
                <strong>Ambient mode</strong> turns off echo cancellation, noise suppression, and auto-gain so the
                mic picks up distant voices. The sensitivity slider boosts the signal up to 8× with a soft limiter
                to prevent clipping. Audio stays on your Mac; only the final text is sent to OpenAI.
              </div>
            </div>

            <div className="card" style={{ marginTop: 24 }}>
              <h2>Recent notes</h2>
              {recordings.length === 0 && (
                <div className="empty">No recordings yet. Hit Start to capture your first note.</div>
              )}
              <div className="history-list">
                {recordings.map(r => (
                  <div
                    key={r.id}
                    className="history-item"
                    onClick={() => setSelectedId(r.id)}
                  >
                    <div className="history-item-main">
                      <div className="history-item-title">{r.title}</div>
                      <div className="history-item-meta">
                        <span>{formatRelative(r.createdAt)}</span>
                        <span className="history-item-time">{formatHMS(r.durationSec)}</span>
                        <span>{r.sources.join(' + ')}</span>
                        {r.language && (
                          <span className="badge badge-neutral" title={`Detected language: ${r.language}`}>
                            {languageFlag(r.language)} {r.language.toUpperCase()}
                          </span>
                        )}
                        {r.review && (
                          <span className={sentimentBadge(r.review.sentiment)}>{r.review.sentiment}</span>
                        )}
                        {r.review?.actionItems?.length ? (
                          <span className="badge badge-purple">{r.review.actionItems.length} action{r.review.actionItems.length > 1 ? 's' : ''}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {selected && sharePayload && (
          <section className="share-card" aria-labelledby="share-title">
            <div className="share-card-header">
              <div className="share-card-copy">
                <div className="share-eyebrow">
                  <span className="share-mark" aria-hidden="true">↗</span>
                  <span>Share securely</span>
                  <span className="share-pill">Local handoff</span>
                </div>
                <h2 id="share-title">Share this note</h2>
                <p>
                  Choose the payload, then hand it to your own email or WhatsApp composer.
                  Notetaker never sends it in the background.
                </p>
              </div>

              <div className="share-summary" aria-label="Selected share content">
                <span className="share-label">Selected</span>
                <strong>{shareSelectionLabel}</strong>
              </div>
            </div>

            <div className="share-workflow" aria-label="Share workflow">
              <div className="share-step">
                <div className="share-step-header">
                  <span className="share-step-number">01</span>
                  <div>
                    <h3>Include</h3>
                    <p>Pick the sections that go into the shared text.</p>
                  </div>
                </div>

                <div className="share-options" role="group" aria-label="Content to share">
                  <button
                    type="button"
                    className="share-option"
                    aria-pressed={sharePayload.sections.includes('transcript')}
                    onClick={() => toggleShareSection('transcript')}
                  >
                    <span className="share-option-check" aria-hidden="true">
                      {sharePayload.sections.includes('transcript') ? '✓' : '○'}
                    </span>
                    <span>
                      <span className="share-option-title">Transcript</span>
                      <span className="share-option-meta">Timestamped local text</span>
                    </span>
                  </button>

                  <button
                    type="button"
                    className="share-option"
                    aria-pressed={sharePayload.sections.includes('review')}
                    onClick={() => toggleShareSection('review')}
                    disabled={!selected.review}
                    title={selected.review ? 'Include AI Review' : 'Generate an AI Review before sharing it'}
                  >
                    <span className="share-option-check" aria-hidden="true">
                      {sharePayload.sections.includes('review') ? '✓' : '○'}
                    </span>
                    <span>
                      <span className="share-option-title">AI Review</span>
                      <span className="share-option-meta">Summary, actions, decisions</span>
                    </span>
                  </button>
                </div>
              </div>

              <div className="share-step">
                <div className="share-step-header">
                  <span className="share-step-number">02</span>
                  <div>
                    <h3>Send with</h3>
                    <p>Open composer, or copy the same payload manually.</p>
                  </div>
                </div>

                <div className="share-actions" aria-label="Share destinations">
                  <a
                    className="share-destination share-destination-primary"
                    href={buildShareUrl('whatsapp', sharePayload)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => announceShare('whatsapp')}
                  >
                    <span className="share-destination-icon" aria-hidden="true">💬</span>
                    <span>
                      <span className="share-option-title">WhatsApp</span>
                      <span className="share-option-meta">Open composer</span>
                    </span>
                  </a>

                  <a
                    className="share-destination"
                    href={buildShareUrl('email', sharePayload)}
                    onClick={() => announceShare('email')}
                  >
                    <span className="share-destination-icon" aria-hidden="true">✉</span>
                    <span>
                      <span className="share-option-title">Email</span>
                      <span className="share-option-meta">Draft message</span>
                    </span>
                  </a>

                  <button type="button" className="share-destination" onClick={copyShareText}>
                    <span className="share-destination-icon" aria-hidden="true">⧉</span>
                    <span>
                      <span className="share-option-title">Copy text</span>
                      <span className="share-option-meta">Fallback for long notes</span>
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <div className="share-hints" aria-live="polite">
              {!selected.review && (
                <p className="share-note">Generate an AI Review to make that section shareable.</p>
              )}
              {shareIsLong && (
                <p className="share-note">
                  This note is long. If a composer trims it, use Copy text and paste it manually.
                </p>
              )}
              {shareNotice && <p className="share-note share-note-success">{shareNotice}</p>}
            </div>
          </section>
        )}

        {selected && (
          <div className="two-col">
            <div className="card card-elevated">
              <h2>Transcript</h2>
              {selected.segments.length > 0 ? (
                <div className="transcript">
                  {selected.segments.map((s, i) => (
                    <div key={i} className="transcript-segment">
                      <span className="transcript-time">[{formatHMS(s.start)}]</span> {s.text}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="transcript">{selected.transcript || '(empty)'}</div>
              )}
            </div>

            <div className="card card-elevated">
              <h2>
                AI Review
                {selected.review && (
                  <span style={{ marginLeft: 8 }} className={sentimentBadge(selected.review.sentiment)}>
                    {selected.review.sentiment}
                  </span>
                )}
              </h2>

              {!selected.review && (
                <div className="empty">
                  No AI review yet.
                  <div style={{ marginTop: 12 }}>
                    <button className="btn btn-primary" onClick={() => rerunReview(selected.id)} disabled={processing !== 'idle'}>
                      Generate review
                    </button>
                  </div>
                </div>
              )}

              {selected.review && (
                <>
                  <div className="review-section">
                    <h3>Summary</h3>
                    <p className="review-text">{selected.review.summary}</p>
                  </div>

                  {selected.review.keyPoints.length > 0 && (
                    <div className="review-section">
                      <h3>Key points</h3>
                      <ul className="review-list">
                        {selected.review.keyPoints.map((p, i) => (
                          <li key={i}><span className="num">{String(i+1).padStart(2,'0')}</span>{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {selected.review.actionItems.length > 0 && (
                    <div className="review-section">
                      <h3>Action items <span className="badge badge-purple">{selected.review.actionItems.length}</span></h3>
                      <ul className="review-list">
                        {selected.review.actionItems.map((p, i) => (
                          <li key={i}><span className="num">→</span>{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {selected.review.decisions.length > 0 && (
                    <div className="review-section">
                      <h3>Decisions</h3>
                      <ul className="review-list">
                        {selected.review.decisions.map((p, i) => (
                          <li key={i}><span className="num">✓</span>{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {selected.review.questions.length > 0 && (
                    <div className="review-section">
                      <h3>Open questions</h3>
                      <ul className="review-list">
                        {selected.review.questions.map((p, i) => (
                          <li key={i}><span className="num">?</span>{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {selected.review.topics.length > 0 && (
                    <div className="review-section">
                      <h3>Topics</h3>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {selected.review.topics.map((t, i) => (
                          <span key={i} className="badge badge-purple">{t}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ fontSize: 11, color: 'var(--color-body)', marginTop: 16 }}>
                    Reviewed by {selected.review.model} · {formatRelative(selected.review.generatedAt)}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
