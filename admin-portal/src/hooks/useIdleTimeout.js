import { useEffect, useRef } from 'react';

export const useIdleTimeout = (onTimeout, idleTimeMs = 3 * 60 * 1000) => {
  const timeoutRef = useRef(null);

  useEffect(() => {
    const handleActivity = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(onTimeout, idleTimeMs);
    };

    // Attach listeners
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('click', handleActivity);
    window.addEventListener('scroll', handleActivity);

    // Initial set
    handleActivity();

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('click', handleActivity);
      window.removeEventListener('scroll', handleActivity);
    };
  }, [onTimeout, idleTimeMs]);
};
