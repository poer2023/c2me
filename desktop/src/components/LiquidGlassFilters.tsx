/**
 * SVG Filters for macOS 26 Liquid Glass Effect
 *
 * These filters create the authentic liquid glass refraction effect
 * using feTurbulence + feDisplacementMap for realistic light distortion.
 */

export const LiquidGlassFilters = () => (
  <svg
    style={{
      position: 'absolute',
      width: 0,
      height: 0,
      overflow: 'hidden',
    }}
    aria-hidden="true"
  >
    <defs>
      {/* Main refraction filter - creates the liquid glass distortion */}
      <filter
        id="liquid-refraction"
        x="-5%"
        y="-5%"
        width="110%"
        height="110%"
        colorInterpolationFilters="sRGB"
      >
        {/* Generate fractal noise pattern for organic distortion */}
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.008"
          numOctaves="4"
          seed="1"
          result="noise"
        />
        {/* Smooth the noise for more natural refraction */}
        <feGaussianBlur in="noise" stdDeviation="3" result="smoothNoise" />
        {/* Apply displacement mapping to create refraction effect */}
        <feDisplacementMap
          in="SourceGraphic"
          in2="smoothNoise"
          scale="8"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>

      {/* Subtle refraction for smaller elements like buttons */}
      <filter
        id="subtle-refraction"
        x="0%"
        y="0%"
        width="100%"
        height="100%"
        colorInterpolationFilters="sRGB"
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.015"
          numOctaves="2"
          seed="2"
          result="noise"
        />
        <feGaussianBlur in="noise" stdDeviation="1.5" result="smoothNoise" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="smoothNoise"
          scale="4"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>

      {/* Edge refraction for panel borders */}
      <filter
        id="edge-refraction"
        x="-10%"
        y="-10%"
        width="120%"
        height="120%"
        colorInterpolationFilters="sRGB"
      >
        <feTurbulence
          type="turbulence"
          baseFrequency="0.02"
          numOctaves="3"
          seed="3"
          result="edgeNoise"
        />
        <feGaussianBlur in="edgeNoise" stdDeviation="2" result="smoothEdge" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="smoothEdge"
          scale="6"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>

      {/* Card-level refraction with moderate distortion */}
      <filter
        id="card-refraction"
        x="-2%"
        y="-2%"
        width="104%"
        height="104%"
        colorInterpolationFilters="sRGB"
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.01"
          numOctaves="3"
          seed="4"
          result="noise"
        />
        <feGaussianBlur in="noise" stdDeviation="2" result="smoothNoise" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="smoothNoise"
          scale="5"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </defs>
  </svg>
);

export default LiquidGlassFilters;
