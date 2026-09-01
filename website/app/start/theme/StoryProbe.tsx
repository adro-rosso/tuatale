'use client';

import { useState } from 'react';
import { probeStory, type ProbeStoryReason } from '@/app/start/_actions/probe-story';
import { Body } from '@/components/ui/Body';
import { fieldControl } from '@/components/ui/form-styles';

interface StoryProbeProps {
  /** Live story text from the parent form's textarea. */
  text: string;
  bookType: string;
  heroName: string | null;
  age: number | null;
  gender: string | null;
  themeLabel: string | null;
  vibe: string | null;
  /** Append the answered Q&A beneath the customer's own text (never overwrites). */
  onAppend: (block: string) => void;
}

function messageForReason(reason: ProbeStoryReason | undefined): string {
  switch (reason) {
    case 'rate_limited':
      return 'Just a moment — please try that again shortly.';
    case 'disabled':
    case 'no_key':
      return "This isn't available right now. You can write your story below.";
    case 'empty':
      return "We couldn't think of anything to ask — your story already has lots to go on.";
    default:
      return "Sorry, we couldn't do that just now. Your story is safe below — please try again.";
  }
}

export function StoryProbe({ text, bookType, heroName, age, gender, themeLabel, vibe, onAppend }: StoryProbeProps) {
  const [loading, setLoading] = useState(false);
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    setAdded(false);
    try {
      const result = await probeStory({ text, bookType, heroName, age, gender, themeLabel, vibe });
      if (result.ok && result.questions?.length) {
        setQuestions(result.questions);
        setAnswers({});
      } else {
        setError(messageForReason(result.reason));
      }
    } catch {
      // probeStory never throws; guard the call anyway so a transport error can't break the step.
      setError(messageForReason(undefined));
    } finally {
      setLoading(false);
    }
  }

  function addToStory() {
    if (!questions) return;
    const answered = questions
      .map((q, i) => ({ q, a: (answers[i] ?? '').trim() }))
      .filter((qa) => qa.a);
    if (answered.length === 0) return;
    const block = `\n\nMore details:\n${answered.map((qa) => `- ${qa.q} ${qa.a}`).join('\n')}`;
    onAppend(block);
    // Collapse and confirm; their answers are now in the editable textarea above.
    setQuestions(null);
    setAnswers({});
    setAdded(true);
  }

  const hasAnswer = Object.values(answers).some((a) => a.trim());

  return (
    <div className="space-y-sm">
      <button
        type="button"
        onClick={() => void run()}
        disabled={loading}
        className="font-body text-iron-oxide text-caption border-iron-oxide/40 px-md py-xs hover:bg-cream-deep inline-flex items-center gap-1 rounded-full border font-semibold transition-colors disabled:opacity-60"
      >
        {loading ? 'Thinking…' : questions ? '↻ Ask me again' : '💬 Answer a few questions to go deeper'}
      </button>

      {error && (
        <p className="font-body text-warm-grey text-caption" role="status">
          {error}
        </p>
      )}
      {added && (
        <p className="font-body text-warm-grey text-caption" role="status">
          Added to your story above — edit it however you like.
        </p>
      )}

      {questions && (
        <div className="border-warm-grey-light bg-cream-deep/50 p-md space-y-md rounded-xl border">
          <Body size="caption">
            A few quick questions to make the book more personal. Answer any you like (all optional):
          </Body>
          {questions.map((q, i) => (
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
          <div className="gap-sm flex flex-wrap">
            <button
              type="button"
              onClick={addToStory}
              disabled={!hasAnswer}
              className="font-heading text-body bg-iron-oxide text-paper px-md py-xs rounded-full not-italic disabled:opacity-50"
            >
              Add to my story
            </button>
            <button
              type="button"
              onClick={() => {
                setQuestions(null);
                setAnswers({});
              }}
              className="font-body text-warm-grey text-caption px-md py-xs font-semibold"
            >
              Skip
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
