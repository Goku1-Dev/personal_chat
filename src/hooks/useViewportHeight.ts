import { useEffect } from 'react';

/**
 * Publishes the genuinely visible height as `--app-height`.
 *
 * Mobile browsers shrink the visual viewport when the keyboard opens but leave
 * 100vh alone, which pushes the composer under the keyboard. visualViewport
 * reports the real number; the resize listener is the fallback.
 */
export function useViewportHeight(): void {
  useEffect(() => {
    const apply = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${height}px`);
    };

    apply();

    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', apply);
    viewport?.addEventListener('scroll', apply);
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);

    return () => {
      viewport?.removeEventListener('resize', apply);
      viewport?.removeEventListener('scroll', apply);
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
    };
  }, []);
}
