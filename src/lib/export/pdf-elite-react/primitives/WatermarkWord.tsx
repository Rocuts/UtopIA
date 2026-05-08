// WatermarkWord.tsx — Giant translucent gray word, anchored bottom-left,
// overflow hidden. Editorial signature element echoing the reference design's
// "INFORME"/"REPORT" wordmark behind page content.
// ───────────────────────────────────────────────────────────────────────────

import * as React from 'react';
import { View, Text } from '@react-pdf/renderer';
import { FONT_DISPLAY, N400, PAGE_W } from '../tokens';

export interface WatermarkWordProps {
  text: string;
  /** Default 0.06. */
  opacity?: number;
}

/**
 * Bottom-anchored watermark wordmark. Caller is responsible for placing this
 * INSIDE a `<Page>` (it positions itself absolutely against its parent).
 */
export function WatermarkWord(props: WatermarkWordProps): React.ReactElement {
  const { text, opacity = 0.06 } = props;
  // Dynamic size: roughly stretch to page width. Cap to avoid disasters.
  const dynamicSize = Math.min(200, (PAGE_W / Math.max(text.length, 1)) * 1.6);

  return (
    <View
      style={{
        position: 'absolute',
        bottom: -20,
        left: -10,
        right: -10,
        overflow: 'hidden',
        opacity,
      }}
    >
      <Text
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 'bold',
          fontSize: dynamicSize,
          color: N400,
          letterSpacing: -2,
          lineHeight: 0.9,
        }}
      >
        {text}
      </Text>
    </View>
  );
}
