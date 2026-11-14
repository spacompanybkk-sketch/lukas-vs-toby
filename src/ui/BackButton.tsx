import type { ButtonHTMLAttributes } from 'preact';

/** The shared Back button: a brown square-ish button with the left arrow and the word BACK in the pixel font. */
export function BackButton({ class: cls = '', ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'aria-label'> & { 'data-action'?: string }) {
  return (
    <button type="button" aria-label="Back" class={`btn pal-wood back ${cls}`.trim()} {...rest}>
      <span class="ico ico--back" aria-hidden="true" />
      <span class="back__word inked">BACK</span>
    </button>
  );
}
