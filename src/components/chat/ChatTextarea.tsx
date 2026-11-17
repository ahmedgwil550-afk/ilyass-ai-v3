import { forwardRef, useImperativeHandle, useRef, useState, useCallback, memo } from "react";
import { Textarea } from "@/components/ui/textarea";

export interface ChatTextareaHandle {
  getValue: () => string;
  setValue: (v: string) => void;
  clear: () => void;
  focus: () => void;
}

interface ChatTextareaProps {
  placeholder?: string;
  initialValue?: string;
  onSubmitEnter?: () => void;
  onChange?: (value: string) => void;
  /** Called when emptiness flips (true=empty, false=non-empty) — used to update Send button disabled state without re-rendering on every keystroke */
  onEmptyChange?: (isEmpty: boolean) => void;
  onHeightChange?: (height: number) => void;
  onFocusChange?: (focused: boolean) => void;
  className?: string;
  dir?: "ltr" | "rtl";
}

/**
 * Self-contained textarea that owns its draft state locally.
 * Parent components do NOT re-render on every keystroke.
 * Read the value imperatively via ref when submitting.
 */
const ChatTextarea = memo(
  forwardRef<ChatTextareaHandle, ChatTextareaProps>(function ChatTextarea(
    { placeholder, initialValue = "", onSubmitEnter, onChange, onEmptyChange, onHeightChange, onFocusChange, className, dir },
    ref,
  ) {
    const [value, setValue] = useState(initialValue);
    const wasEmpty = useRef(initialValue.length === 0);
    const innerRef = useRef<HTMLTextAreaElement>(null);

    useImperativeHandle(ref, () => ({
      getValue: () => value,
      setValue: (v: string) => {
        if (innerRef.current) {
          const el = innerRef.current;
          // Update the DOM value before measuring so programmatic drafts grow
          // the outer composer just like text entered by the user.
          el.value = v;
          el.style.height = "auto";
          const maxHeight = Math.max(28, Math.floor(window.innerHeight * 0.5) - 24);
          const nextHeight = Math.min(el.scrollHeight, maxHeight);
          el.style.height = `${nextHeight}px`;
          el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
          onHeightChange?.(nextHeight);
        }
        setValue(v);
        const empty = v.length === 0;
        if (empty !== wasEmpty.current) {
          wasEmpty.current = empty;
          onEmptyChange?.(empty);
        }
      },
      clear: () => {
        if (innerRef.current) {
          innerRef.current.style.height = "";
          innerRef.current.style.overflowY = "hidden";
        }
        onHeightChange?.(28);
        setValue("");
        if (!wasEmpty.current) {
          wasEmpty.current = true;
          onEmptyChange?.(true);
        }
      },
      focus: () => innerRef.current?.focus(),
    }), [value, onEmptyChange, onHeightChange]);

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const v = e.target.value;
        const el = e.currentTarget;
        // Grow with the draft, but never let the composer occupy more than
        // half of the visible device height.
        el.style.height = "auto";
        const maxHeight = Math.floor(window.innerHeight * 0.5) - 24;
        const nextHeight = Math.min(el.scrollHeight, Math.max(28, maxHeight));
        el.style.height = `${nextHeight}px`;
        el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
        onHeightChange?.(nextHeight);
        setValue(v);
        const empty = v.length === 0;
        if (empty !== wasEmpty.current) {
          wasEmpty.current = empty;
          onEmptyChange?.(empty);
        }
        onChange?.(v);
      },
      [onChange, onEmptyChange, onHeightChange],
    );

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onSubmitEnter?.();
        }
      },
      [onSubmitEnter],
    );

    // Dynamic font shrinking for long text — purely local computation
    const fontSize =
      value.length > 80
        ? `${Math.max(15, 17 - Math.floor((value.length - 80) / 40))}px`
        : undefined;

    return (
      <Textarea
        ref={innerRef}
        dir={dir}
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        style={{ fontSize, height: "28px", minHeight: "28px", overflowY: "hidden" }}
        className={className}
        rows={1}
      />
    );
  }),
);

export default ChatTextarea;
