import type { ReactNode } from "react";

/** معادلة مستقلة (display): من اليسار لليمين دائماً، وتتمرّر أفقياً إن عرضت عن الشاشة. span حتى يصحّ داخل <p>. */
export default function MathBlock({ children }: { children?: ReactNode }) {
  return (
    <span className="math-block" dir="ltr">
      {children}
    </span>
  );
}
