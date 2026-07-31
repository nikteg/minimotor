export interface AccessibilityPreferences {
  reducedMotion: boolean;
  highContrast: boolean;
  vibration: boolean;
  uiScale: number;
}

export interface AccessibilityApi extends AccessibilityPreferences {
  set(preferences: Partial<AccessibilityPreferences>): void;
  reset(): void;
  subscribe(listener: (preferences: Readonly<AccessibilityPreferences>) => void): () => void;
}

export function createAccessibility(): AccessibilityApi {
  const systemReduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const systemContrast = matchMedia("(prefers-contrast: more)").matches;
  const initial: AccessibilityPreferences = {
    reducedMotion: systemReduced,
    highContrast: systemContrast,
    vibration: true,
    uiScale: 1,
  };
  const value = { ...initial };
  const listeners = new Set<(preferences: Readonly<AccessibilityPreferences>) => void>();
  const notify = () => listeners.forEach((listener) => listener(value));
  return {
    get reducedMotion() {
      return value.reducedMotion;
    },
    get highContrast() {
      return value.highContrast;
    },
    get vibration() {
      return value.vibration;
    },
    get uiScale() {
      return value.uiScale;
    },
    set(preferences) {
      Object.assign(value, preferences);
      notify();
    },
    reset() {
      Object.assign(value, initial);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
