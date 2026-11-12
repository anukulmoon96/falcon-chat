import { useCallback, useEffect, useRef, useState } from 'react';

const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

const ERRORS = {
  'not-allowed': "Microphone access is blocked. Allow it in your browser's site settings to use voice input.",
  'service-not-allowed': "Microphone access is blocked. Allow it in your browser's site settings to use voice input.",
  'audio-capture': 'No microphone was found. Check that one is connected.',
  'no-speech': "Didn't catch that. Try speaking again.",
  network: 'Voice input needs an internet connection.',
  'language-not-supported': "Voice input isn't available for your browser language.",
};

// Browser speech-to-text. onText(final, interim) fires as words arrive: `final` is
// everything confirmed this session, `interim` the words still being recognised.
export function useSpeechToText(onText) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const recognition = useRef(null);
  const handler = useRef(onText);
  handler.current = onText;

  const stop = useCallback(() => recognition.current?.stop(), []);
  // Unlike stop(), drops any words still being recognised.
  const cancel = useCallback(() => {
    if (recognition.current) recognition.current.onresult = null;
    recognition.current?.abort();
  }, []);

  const start = useCallback(() => {
    if (!Recognition || recognition.current) return;
    const r = new Recognition();
    r.lang = navigator.language || 'en-US';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let final = '';
      let interim = '';
      for (const result of e.results) {
        if (result.isFinal) final += result[0].transcript;
        else interim += result[0].transcript;
      }
      handler.current(final, interim);
    };
    r.onerror = (e) => {
      if (e.error !== 'aborted') setError(ERRORS[e.error] || 'Voice input stopped unexpectedly. Try again.');
    };
    r.onend = () => {
      recognition.current = null;
      setListening(false);
    };
    recognition.current = r;
    setError('');
    setListening(true);
    r.start();
  }, []);

  useEffect(() => () => recognition.current?.abort(), []);

  return { supported: Boolean(Recognition), listening, error, start, stop, cancel, clearError: () => setError('') };
}
