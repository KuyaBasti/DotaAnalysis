import { useCallback, useEffect, useRef, useState } from "react";
import { clamp } from "./playback";

export interface Playback {
  clock: number; // game seconds elapsed
  playing: boolean;
  speed: number; // game-seconds advanced per real second
  atEnd: boolean;
  setSpeed: (s: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
}

// A play head over a finite timeline. The clock advances in real time (via
// requestAnimationFrame) scaled by `speed`; play/pause/seek drive it. Reading
// the speed from a ref keeps the animation loop stable when speed changes.
export function usePlayback(duration: number, initialSpeed = 60): Playback {
  const [clock, setClock] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(initialSpeed);

  const clockRef = useRef(0);
  const speedRef = useRef(initialSpeed);
  speedRef.current = speed;

  const set = useCallback(
    (t: number) => {
      const v = clamp(t, 0, duration);
      clockRef.current = v;
      setClock(v);
    },
    [duration],
  );

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = clockRef.current + dt * speedRef.current;
      if (next >= duration) {
        clockRef.current = duration;
        setClock(duration);
        setPlaying(false);
        return;
      }
      clockRef.current = next;
      setClock(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration]);

  const play = useCallback(() => {
    if (clockRef.current >= duration) set(0); // replay from the top
    setPlaying(true);
  }, [duration, set]);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(
    () => (playing ? pause() : play()),
    [playing, play, pause],
  );

  return {
    clock,
    playing,
    speed,
    atEnd: clock >= duration,
    setSpeed,
    play,
    pause,
    toggle,
    seek: set,
  };
}
