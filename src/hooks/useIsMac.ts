'use client';

import { useEffect, useState } from 'react';

type UAData = { platform?: string };
type NavigatorWithUAData = Navigator & { userAgentData?: UAData };

export function useIsMac(): boolean {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    const nav = navigator as NavigatorWithUAData;
    const platform =
      nav.userAgentData?.platform ?? nav.platform ?? '';
    const ua = nav.userAgent ?? '';
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMac(/mac/i.test(platform) || /Mac|iP(hone|ad|od)/.test(ua));
  }, []);

  return isMac;
}
