import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * Owns the folded log for one lot. It is lifted out of the TimeTravel panel so
 * the guided tour can seek it too.
 */
export function useTimeline(lotId, version) {
  const [points, setPoints] = useState([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const indexRef = useRef(0);
  const pointsRef = useRef(0);
  indexRef.current = index;
  pointsRef.current = points.length;

  const load = useCallback(
    async (follow = true) => {
      if (!lotId) return;
      setLoading(true);
      try {
        const data = await api.timeline(lotId);
        setPoints(data.points);
        setError(null);
        if (follow) setIndex(Math.max(0, data.points.length - 1));
        else setIndex((current) => Math.min(current, Math.max(0, data.points.length - 1)));
      } catch (cause) {
        setError(cause.message);
      } finally {
        setLoading(false);
      }
    },
    [lotId],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  // Follow the head while the reader is parked there; never yank the scrubber
  // away from someone reading the past.
  useEffect(() => {
    if (!lotId) return undefined;
    const timer = setTimeout(() => {
      if (indexRef.current >= pointsRef.current - 1) void load(true);
    }, 1400);
    return () => clearTimeout(timer);
  }, [version, lotId, load]);

  const seekFraction = useCallback((fraction) => {
    const last = Math.max(0, pointsRef.current - 1);
    setIndex(Math.round(last * Math.min(1, Math.max(0, fraction))));
  }, []);

  return {
    points,
    index,
    setIndex,
    seekFraction,
    reload: () => load(false),
    loading,
    error,
  };
}
