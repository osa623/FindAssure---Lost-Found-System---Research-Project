import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import axios from 'axios';

const API_BASE_URL = 'http://localhost:8001';

/* ─── Category options ──────────────────────────────────────────────── */
const CATEGORIES = [
  'Wallet', 'Phone', 'ID Card', 'Bag',
  'Umbrella', 'Keys', 'Laptop', 'Other',
];

/* ─── Helper: score colour ──────────────────────────────────────────── */
const scoreBadge = (score) => {
  if (score >= 70)
    return 'bg-emerald-50 text-emerald-700 ring-emerald-600/20';
  if (score >= 50)
    return 'bg-amber-50 text-amber-700 ring-amber-600/20';
  return 'bg-zinc-100 text-zinc-600 ring-zinc-500/20';
};

/* ════════════════════════════════════════════════════════════════════════
   App
   ════════════════════════════════════════════════════════════════════════ */

function App() {
  /* state */
  const [activeTab, setActiveTab] = useState('add');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);          // { type, text }
  const [searchMeta, setSearchMeta] = useState({ query_id: null, impression_id: null });
  const [feedbackGiven, setFeedbackGiven] = useState({});
  const [feedbackStats, setFeedbackStats] = useState(null);
  const [grammarNote, setGrammarNote] = useState(null);      // e.g. "Fixed: blak → black"
  const [grammarChecking, setGrammarChecking] = useState(false);
  const grammarTimer = useRef(null);

  /* ── helpers ────────────────────────────────────────────────────────── */
  const flash = (type, text) => setMessage({ type, text });

  const fetchFeedbackStats = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/feedback-stats`);
      setFeedbackStats(res.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchFeedbackStats();
    const id = setInterval(fetchFeedbackStats, 30_000);
    return () => clearInterval(id);
  }, [fetchFeedbackStats]);

  /* ── Live grammar correction (debounced, search tab only) ───────────  */
  const triggerGrammarCheck = useCallback((text) => {
    // Clear any pending timer
    if (grammarTimer.current) clearTimeout(grammarTimer.current);
    setGrammarNote(null);

    if (!text || text.trim().length < 5 || activeTab !== 'search') return;

    grammarTimer.current = setTimeout(async () => {
      setGrammarChecking(true);
      try {
        const res = await axios.post(`${API_BASE_URL}/correct-grammar`, { text });
        if (res.data.was_corrected && res.data.corrected_text) {
          setDescription(res.data.corrected_text);
          const fixes = res.data.corrections?.length
            ? res.data.corrections.join(', ')
            : 'Grammar auto-corrected';
          setGrammarNote(fixes);
          // Auto-dismiss note after 4 seconds
          setTimeout(() => setGrammarNote(null), 4000);
        }
      } catch { /* silently skip */ }
      finally { setGrammarChecking(false); }
    }, 1200); // 1.2s debounce after user stops typing
  }, [activeTab]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => { if (grammarTimer.current) clearTimeout(grammarTimer.current); };
  }, []);

  /* ── Add Found Item ─────────────────────────────────────────────────  */
  const handleAddItem = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const itemId = `FOUND-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const res = await axios.post(`${API_BASE_URL}/index`, {
        id: itemId, description, category,
      });
      flash('success', `Found item added — ${res.data.item_id}${res.data.grammar_corrected ? ' (grammar auto-corrected)' : ''}`);
      setCategory('');
      setDescription('');
    } catch (err) {
      flash('error', err.response?.data?.detail || err.message);
    } finally {
      setLoading(false);
    }
  };

  /* ── Search ─────────────────────────────────────────────────────────  */
  const handleSearch = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setSearchResults([]);
    setSearchMeta({ query_id: null, impression_id: null });
    setFeedbackGiven({});
    try {
      const res = await axios.post(`${API_BASE_URL}/search`, {
        text: description,
        category,
        limit: 10,
        session_id: `session-${Date.now()}`,
      });
      if (res.data.matches?.length) {
        // Only show results with confidence score > 50%
        const filtered = res.data.matches.filter((m) => m.score > 50);
        setSearchResults(filtered);
        setSearchMeta({
          query_id: res.data.query_id || null,
          impression_id: res.data.impression_id || null,
        });
        if (filtered.length) {
          const grammarNote = res.data.grammar_corrected
            ? ` (auto-corrected: "${res.data.corrected_text}")`
            : '';
          flash('success', `${filtered.length} matching item${filtered.length > 1 ? 's' : ''} found${grammarNote}`);
        } else {
          flash('info', `${res.data.total_matches} items checked but none exceeded 50% confidence`);
        }
      } else {
        flash('info', 'No matching items found in the database');
      }
    } catch (err) {
      flash('error', err.response?.data?.detail || err.message);
    } finally {
      setLoading(false);
    }
  };

  /* ── Selection / Feedback ───────────────────────────────────────────  */
  const handleSelectItem = async (foundId, rank) => {
    if (!searchMeta.impression_id || !searchMeta.query_id) return;
    try {
      await axios.post(`${API_BASE_URL}/log-selection`, {
        impression_id: searchMeta.impression_id,
        query_id: searchMeta.query_id,
        lost_item_raw: description,
        selected_found_id: foundId,
        selected_rank: rank,
      });
    } catch { /* silently */ }
  };

  const handleFeedback = async (foundId, rank, isCorrect) => {
    await handleSelectItem(foundId, rank);
    try {
      await axios.post(`${API_BASE_URL}/feedback`, {
        query_id: searchMeta.query_id,
        found_id: foundId,
        is_correct: isCorrect,
        impression_id: searchMeta.impression_id,
      });
      setFeedbackGiven((prev) => ({ ...prev, [foundId]: isCorrect }));
      flash('success', isCorrect
        ? 'Thanks for confirming! This helps improve future matches.'
        : 'Thanks for letting us know. This helps improve accuracy.');
      fetchFeedbackStats();
    } catch (err) {
      flash('error', `Feedback failed: ${err.message}`);
    }
  };

  /* ═══════════════════════════════════════════════════════════════════
     Render
     ═══════════════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f] antialiased">
      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-white/80 border-b border-zinc-200/60">
        <div className="mx-auto max-w-3xl flex items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">FindAssure</h1>
            <p className="text-xs text-zinc-500 mt-0.5">AI-Powered Lost &amp; Found</p>
          </div>
          {/* live connection dot */}
          <span className="relative flex h-2.5 w-2.5" title="System status">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-8 space-y-6">
        {/* ── Tabs ────────────────────────────────────────────────────── */}
        <nav className="flex gap-1 rounded-xl bg-zinc-200/60 p-1">
          {[
            { key: 'add', label: 'Report Found' },
            { key: 'search', label: 'Find My Item' },
            { key: 'stats', label: 'Statistics' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => {
                setActiveTab(key);
                if (key === 'stats') fetchFeedbackStats();
              }}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all duration-200 ${
                activeTab === key
                  ? 'bg-white text-[#1d1d1f] shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-800'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* ── Toast / message ─────────────────────────────────────────── */}
        {message && (
          <div
            className={`rounded-xl px-5 py-3.5 text-sm font-medium transition-all duration-300 ${
              message.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'
                : message.type === 'info'
                ? 'bg-sky-50 text-sky-800 ring-1 ring-sky-200'
                : 'bg-red-50 text-red-800 ring-1 ring-red-200'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* ═══════════ ADD FOUND ITEM ═══════════════════════════════════ */}
        {activeTab === 'add' && (
          <section className="rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100 overflow-hidden">
            <div className="px-6 pt-6 pb-2">
              <h2 className="text-lg font-semibold">Report a Found Item</h2>
              <p className="text-sm text-zinc-500 mt-1">
                Describe the item you found so the owner can locate it.
              </p>
            </div>
            <form onSubmit={handleAddItem} className="px-6 pb-6 space-y-5 pt-4">
              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  required
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
                >
                  <option value="">Select a category</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the found item — colour, brand, contents, where you found it…"
                  rows={4}
                  required
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 resize-y"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-[#1d1d1f] text-white py-3 text-sm font-semibold hover:bg-zinc-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? 'Adding…' : 'Submit Found Item'}
              </button>
            </form>
          </section>
        )}

        {/* ═══════════ SEARCH LOST ITEM ═════════════════════════════════ */}
        {activeTab === 'search' && (
          <section className="space-y-5">
            <div className="rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100 overflow-hidden">
              <div className="px-6 pt-6 pb-2">
                <h2 className="text-lg font-semibold">Find My Lost Item</h2>
                <p className="text-sm text-zinc-500 mt-1">
                  Describe what you lost and our AI will search all reported found items.
                </p>
              </div>
              <form onSubmit={handleSearch} className="px-6 pb-6 space-y-5 pt-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    required
                    className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
                  >
                    <option value="">Select a category</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5">Description of Your Lost Item</label>
                  <textarea
                    value={description}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      triggerGrammarCheck(e.target.value);
                    }}
                    placeholder="Describe your lost item — colour, brand, contents, any amounts inside…"
                    rows={4}
                    required
                    className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 resize-y"
                  />
                  {/* Live grammar indicator */}
                  {grammarChecking && (
                    <p className="mt-1.5 text-xs text-zinc-400 animate-pulse">Checking grammar…</p>
                  )}
                  {grammarNote && (
                    <p className="mt-1.5 text-xs text-emerald-600 flex items-center gap-1">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                      {grammarNote}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-[#0071e3] text-white py-3 text-sm font-semibold hover:bg-[#0077ed] transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Searching…
                    </span>
                  ) : 'Search'}
                </button>
              </form>
            </div>

            {/* ── Results ─────────────────────────────────────────────── */}
            {searchResults.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide px-1">
                  {searchResults.length} Matching Items
                </h3>
                {searchMeta.query_id && (
                  <p className="text-xs text-zinc-400 px-1">
                    Please confirm if any item is yours — your feedback improves our AI.
                  </p>
                )}

                {searchResults.map((result, index) => (
                  <div
                    key={index}
                    className={`rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100 p-5 transition-all duration-200 hover:shadow-md ${
                      feedbackGiven[result.id] !== undefined ? 'opacity-70' : ''
                    }`}
                  >
                    {/* header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-mono text-zinc-400 truncate block">
                          {result.id}
                        </span>
                        <span className="inline-block mt-1 text-xs font-medium text-zinc-500 bg-zinc-100 rounded-md px-2 py-0.5">
                          {result.category}
                        </span>
                      </div>
                      <span
                        className={`shrink-0 inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${scoreBadge(result.score)}`}
                      >
                        {result.score.toFixed(1)}%
                      </span>
                    </div>

                    {/* body */}
                    <p className="mt-3 text-sm text-zinc-700 leading-relaxed">
                      {result.description}
                    </p>
                    <p className="mt-2 text-xs text-zinc-400 italic">
                      {result.reason}
                    </p>

                    {/* feedback */}
                    {searchMeta.query_id && (
                      <div className="mt-4 pt-3 border-t border-zinc-100">
                        {feedbackGiven[result.id] !== undefined ? (
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                              feedbackGiven[result.id]
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-red-50 text-red-700'
                            }`}
                          >
                            {feedbackGiven[result.id] ? '✓ Confirmed as yours' : '✗ Not your item'}
                          </span>
                        ) : (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-zinc-500 mr-1">Is this your item?</span>
                            <button
                              onClick={() => handleFeedback(result.id, index + 1, true)}
                              className="rounded-lg bg-emerald-600 text-white text-xs font-medium px-4 py-1.5 hover:bg-emerald-700 transition"
                            >
                              Yes, it's mine
                            </button>
                            <button
                              onClick={() => handleFeedback(result.id, index + 1, false)}
                              className="rounded-lg bg-zinc-200 text-zinc-700 text-xs font-medium px-4 py-1.5 hover:bg-zinc-300 transition"
                            >
                              No
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ═══════════ STATS TAB ════════════════════════════════════════ */}
        {activeTab === 'stats' && (
          <section className="space-y-5">
            <div className="rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100 p-6">
              <h2 className="text-lg font-semibold">Feedback &amp; Training</h2>
              <p className="text-sm text-zinc-500 mt-1">
                The AI improves automatically as more feedback is collected.
              </p>
            </div>

            {feedbackStats?.status === 'ok' ? (
              <>
                {/* Metric cards */}
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: 'Search Impressions', value: feedbackStats.impressions, sub: 'Total searches performed', color: 'border-zinc-300' },
                    { label: 'Item Selections', value: feedbackStats.selections, sub: 'Items users interacted with', color: 'border-zinc-300' },
                    { label: 'Positive Feedback', value: feedbackStats.verifications?.positive || 0, sub: '"Yes, this is mine"', color: 'border-emerald-400' },
                    { label: 'Negative Feedback', value: feedbackStats.verifications?.negative || 0, sub: '"No, not mine"', color: 'border-red-400' },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className={`rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100 p-5 border-l-4 ${stat.color}`}
                    >
                      <p className="text-3xl font-bold tracking-tight">{stat.value}</p>
                      <p className="text-sm font-medium text-zinc-600 mt-1">{stat.label}</p>
                      <p className="text-xs text-zinc-400 mt-0.5">{stat.sub}</p>
                    </div>
                  ))}
                </div>

                {/* Training readiness */}
                <div className="rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100 p-6 text-center">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold ${
                      feedbackStats.training_ready
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${feedbackStats.training_ready ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    {feedbackStats.training_ready ? 'Ready to Retrain' : 'Collecting Data'}
                  </span>
                  <p className="text-sm text-zinc-500 mt-3">{feedbackStats.message}</p>

                  {/* progress bar */}
                  <div className="mt-4 w-full h-2 bg-zinc-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#0071e3] rounded-full transition-all duration-700"
                      style={{
                        width: `${Math.min(100, ((feedbackStats.verifications?.positive || 0) / feedbackStats.min_required) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-zinc-400 mt-2">
                    {feedbackStats.verifications?.positive || 0} / {feedbackStats.min_required} verified pairs
                  </p>
                </div>
              </>
            ) : (
              <div className="rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100 p-8 text-center">
                <p className="text-sm text-zinc-500">
                  {feedbackStats?.reason === 'database not connected'
                    ? 'Database not connected. Statistics unavailable.'
                    : 'Loading statistics…'}
                </p>
              </div>
            )}
          </section>
        )}
      </main>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="text-center py-8 text-xs text-zinc-400">
        FindAssure &mdash; Smart Lost &amp; Found System
      </footer>
    </div>
  );
}

export default App;