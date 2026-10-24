import './tokens.css';
import './unsupported.css';

/** Something that can hand out a drawing context, like a canvas. */
export interface ContextSource {
  getContext(kind: string): unknown;
}

/** True when the browser can run WebGL. The canvas is made by `create` so a test can stand in for the page. */
export function webglAvailable(
  create: () => ContextSource = () => document.createElement('canvas'),
): boolean {
  try {
    const canvas = create();
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** The words on the page: what went wrong, in plain terms, and what to try. */
export function unsupportedMessage(reason: 'webgl' | 'error'): { title: string; lines: string[] } {
  return reason === 'webgl'
    ? {
        title: 'Your browser cannot show 3D',
        lines: [
          'Flying Cars needs WebGL, which this browser has turned off or does not have.',
          'Try the newest Chrome, Edge or Firefox on a desktop computer, and make sure "hardware acceleration" is switched on in its settings.',
        ],
      }
    : {
        title: 'Flying Cars could not start',
        lines: [
          'Something went wrong while loading the game.',
          'Reload the page. If it keeps happening, try the newest Chrome, Edge or Firefox on a desktop computer.',
        ],
      };
}

/** Replaces the page with the message. */
export function showUnsupported(container: HTMLElement, reason: 'webgl' | 'error'): void {
  const { title, lines } = unsupportedMessage(reason);
  const page = document.createElement('div');
  page.className = 'unsupported';
  page.setAttribute('role', 'alert');
  const heading = document.createElement('h1');
  heading.innerHTML = 'Flying <span>Cars</span>';
  const sub = document.createElement('p');
  sub.className = 'tips';
  sub.textContent = title;
  page.append(heading, sub);
  for (const line of lines) {
    const p = document.createElement('p');
    p.textContent = line;
    page.appendChild(p);
  }
  container.replaceChildren(page);
}
