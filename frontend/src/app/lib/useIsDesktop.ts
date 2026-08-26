'use client';

import { useEffect, useState } from 'react';
import { isDesktop as detectDesktop } from './api';

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setIsDesktop(detectDesktop());
  }, []);

  return isDesktop;
}
