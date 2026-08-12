'use client';

import { useState } from 'react';
import { improveStory, type ImproveStoryReason } from '@/app/start/_actions/improve-story';
import { Body } from '@/components/ui/Body';
import { fieldControl } from '@/components/ui/form-styles';

interface StoryAssistProps {
  /** Live story text from the parent form's textarea. */
  text: string;
  bookType: string;
  heroName: string | null;
  /** Title of the currently-selected template, if any. */
  themeLabel: string | null;
  vibe: string | null;
  /** Fill the story textarea with the improved text (editable, never auto-overwrite elsewhere). */
  onUse: (improved: string) => void;
}

interface Suggestion {
  improvedText: string;
  questions: string[];
}

// Friendly, non-technical copy per soft-fail reason. 'no_key' is treated as "not
// available right now" so the button breaks nothing when the key isn't set.
function messageForReason(reason: ImproveStoryReason | undefined): string {
  switch (reason) {
    case 'rate_limited':
      return 'Just a moment — please try that again shortly.';
    case 'no_key':
      return "Writing help isn't available right now. You can write your story below.";
    default:
      return "Sorry, we couldn't help with that just now. Your story is safe below — please try again.";
  }
}

export function StoryAssist({ text, bookType, heroName, themeLabel, vibe, onUse }: StoryAssistProps) {
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  async function run(sourceText: string) {
    setLoading(true);
    setError(null);
    try {
      const result = await improveStory({ text: sourceText, bookType, heroName, themeLabel, vibe });
      if (result.ok && result.improvedText) {
        setSuggestion({ improvedText: result.improvedText, questions: result.questions ?? [] });
      } else {
        setError(messageForReason(result.reason));
      }
    } catch {
      // improveStory itself never throws, but guard the call so a transport error can't
      // break the theme step either.
      setError(messageForReason(undefined));
    } finally {
      setLoading(false);
    }
  }

  // Re-run using the current suggestion plus any answers the customer typed, so answering
  // a question refines the brief rather than starting over.
  function refineWithAnswers() {
    if (!suggestion) return;
    const answered = suggestion.questions
      .map((q, i) => ({ q, a: (answers[i] ?? '').trim() }))
      .filter((qa) => qa.a);
    const extra = answered.length
      ? `\n\nExtra details:\n${answered.map((qa) => `${qa.q} ${qa.a}`).join('\n')}`
      : '';
    void run(`${suggestion.improvedText}${extra}`);
  }

  function dismiss() {
    setSuggestion(null);
    setError(null);
    setAnswers({});
  }

  const hasAnswer = Object.values(answers).some((a) => a.trim());

  return (
    <div className="space-y-sm">
      <button
        type="button"
        onClick={() => void run(text)}
        disabled={loading}
        className="font-body text-iron-oxide text-caption border-iron-oxide/40 px-md py-xs hover:bg-cream-deep inline-flex items-center gap-1 rounded-full border font-semibold transition-colors disabled:opacity-60"
      >
        {loading ? 'Thinking…' : '✨ Help me write this'}
      </button>

      {error && (
        <p className="font-body text-warm-grey text-caption" role="status">
          {error}
        </p>
      )}

      {suggestion && (
        <div className="border-warm-grey-light bg-cream-deep/50 p-md space-y-md rounded-xl border">
          <div className="space-y-xs">
            <p className="font-body text-warm-grey text-caption tracking-wider uppercase">Suggested story</p>
            <p className="font-body text-near-black text-body whitespace-pre-wrap">{suggestion.improvedText}</p>
          </div>

          {suggestion.questions.length > 0 && (
            <div className="space-y-sm">
              <Body size="caption">A couple of quick questions to make it more personal (optional):</Body>
              {suggestion.questions.map((q, i) => (
                <div key={i} className="space-y-xs">
                  <label className="font-body text-near-black text-caption block">{q}</label>
                  <input
                    type="text"
                    value={answers[i] ?? ''}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [i]: e.target.value }))}
                    className={fieldControl}
                    placeholder="Optional"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={refineWithAnswers}
                disabled={loading || !hasAnswer}
                className="font-body text-iron-oxide text-caption font-semibold underline disabled:opacity-50"
              >
                Refine with my answers
              </button>
            </div>
          )}

          <div className="gap-sm flex flex-wrap">
            <button
              type="button"
              onClick={() => {
                onUse(suggestion.improvedText);
                dismiss();
              }}
              className="font-heading text-body bg-iron-oxide text-paper px-md py-xs rounded-full not-italic"
            >
              Use this
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="font-body text-warm-grey text-caption px-md py-xs font-semibold"
            >
              Keep mine
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
