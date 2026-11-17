import { useId } from "react";
import type { SVGProps } from "react";

type AcademicEmblemProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  animated?: boolean;
};

/**
 * ILYASS AI signature mark.
 * A compact, geometric monogram combining an open book, an ascending
 * knowledge path, and a precise orbital stroke. Designed to stay legible
 * from small interface icons to larger brand placements.
 */
export function AcademicEmblem({ size = 220, animated = false, ...props }: AcademicEmblemProps) {
  const id = useId().replace(/:/g, "");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="ILYASS AI"
      {...props}
    >
      <defs>
        <linearGradient id={`${id}-silver`} x1="22" y1="14" x2="104" y2="112" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" />
          <stop offset=".28" stopColor="#C9D8EC" />
          <stop offset=".58" stopColor="#8298B8" />
          <stop offset=".82" stopColor="#F4F8FF" />
          <stop offset="1" stopColor="#A8B9D2" />
        </linearGradient>
        <linearGradient id={`${id}-blue`} x1="30" y1="24" x2="98" y2="102" gradientUnits="userSpaceOnUse">
          <stop stopColor="#B9E7FF" />
          <stop offset=".52" stopColor="#60B8FF" />
          <stop offset="1" stopColor="#777BFF" />
        </linearGradient>
        <linearGradient id={`${id}-page`} x1="34" y1="65" x2="94" y2="105" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F8FBFF" />
          <stop offset="1" stopColor="#9DB2D0" />
        </linearGradient>
        <filter id={`${id}-shadow`} x="8" y="7" width="112" height="114" filterUnits="userSpaceOnUse">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <filter id={`${id}-glow`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Restrained dimensional halo */}
      <path
        d="M64 12C35.3 12 12 35.3 12 64s23.3 52 52 52 52-23.3 52-52"
        stroke="#5B8CCB"
        strokeWidth="1.5"
        opacity=".16"
      />
      <path
        d="M64 12C35.3 12 12 35.3 12 64"
        stroke={`url(#${id}-blue)`}
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity=".8"
      />

      {/* Central rising A / knowledge flame */}
      <path
        d="M64 22L91 69H79L64 43L49 69H37L64 22Z"
        fill={`url(#${id}-silver)`}
        stroke="#F5FAFF"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path d="M53 61H75" stroke={`url(#${id}-blue)`} strokeWidth="4" strokeLinecap="round" />
      <path d="M64 32V49" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity=".9" />

      {/* Open book: two balanced pages meeting at the spine */}
      <path
        d="M64 79C53.5 70.5 39.2 68.5 25 74.2V91.5C39.1 86.8 52.2 89.1 64 99C75.8 89.1 88.9 86.8 103 91.5V74.2C88.8 68.5 74.5 70.5 64 79Z"
        fill="#15243A"
        fillOpacity=".38"
        stroke={`url(#${id}-silver)`}
        strokeWidth="3.2"
        strokeLinejoin="round"
      />
      <path
        d="M64 80V98M32 79.5C43.1 76.6 53.2 79.3 61 85M96 79.5C84.9 76.6 74.8 79.3 67 85"
        stroke={`url(#${id}-blue)`}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path d="M35 86C44 84.4 52 86.4 59 91M93 86C84 84.4 76 86.4 69 91" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" opacity=".55" />

      {/* Signature orbital sweep */}
      <path
        d="M91 26C105.8 36.5 113 54.4 109.2 71.8C106.1 86.1 96.7 98.4 83.8 104.7"
        stroke={`url(#${id}-blue)`}
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <circle cx="92" cy="25" r="3.5" fill="#DDF4FF" stroke={`url(#${id}-blue)`} strokeWidth="1.5" />
      <circle cx="84" cy="105" r="2.6" fill="#A8DFFF" />

      {animated && (
        <path
          d="M15 64C15 37 37 15 64 15C91 15 113 37 113 64C113 82 103 98 88 107"
          stroke="#FFFFFF"
          strokeWidth="2.8"
          strokeLinecap="round"
          opacity=".8"
          filter={`url(#${id}-glow)`}
          strokeDasharray="34 240"
        >
          <animate attributeName="stroke-dashoffset" values="274;0;-274" dur="3.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values=".12;.9;.12" dur="3.4s" repeatCount="indefinite" />
        </path>
      )}
    </svg>
  );
}

export default AcademicEmblem;
