import { escapeXmlTags } from '../index.ts';

export function queryRequired<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }
  return element;
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'Unknown error';
}

export function setAlert(
  target: HTMLElement,
  message: string,
  tone: 'secondary' | 'success' | 'warning' | 'danger' | 'info' = 'secondary',
): void {
  target.innerHTML = `<div class="alert alert-${tone} py-2 mb-0">${escapeXmlTags(message)}</div>`;
}

export function setButtonState(button: HTMLButtonElement, text: string, disabled = false): void {
  button.textContent = text;
  button.disabled = disabled;
}

export class MediaRenderer {
  private readonly items = new Map<string, { wrapper: HTMLDivElement; element: HTMLMediaElement; stream: MediaStream }>();

  constructor(
    private readonly container: HTMLElement,
    private readonly emptyText: string,
    private readonly muted = false,
  ) {
    this.renderEmptyState();
  }

  update(track: MediaStreamTrack, key: string, on: boolean, label: string): void {
    if (on) {
      const item = this.items.get(key) ?? this.createItem(key, track.kind, label);
      const alreadyAdded = item.stream.getTracks().some((existingTrack) => existingTrack.id === track.id);
      if (!alreadyAdded) {
        item.stream.addTrack(track);
      }
      item.element.srcObject = item.stream;
      return;
    }

    const item = this.items.get(key);
    if (!item) {
      return;
    }

    for (const existingTrack of item.stream.getTracks()) {
      if (existingTrack.id === track.id) {
        item.stream.removeTrack(existingTrack);
      }
    }

    if (item.stream.getTracks().length === 0) {
      item.element.srcObject = null;
      item.wrapper.remove();
      this.items.delete(key);
      if (this.items.size === 0) {
        this.renderEmptyState();
      }
    }
  }

  clear(): void {
    for (const item of this.items.values()) {
      item.element.srcObject = null;
    }
    this.items.clear();
    this.container.innerHTML = '';
    this.renderEmptyState();
  }

  private createItem(key: string, kind: string, label: string) {
    if (this.items.size === 0) {
      this.container.innerHTML = '';
    }

    const column = document.createElement('div');
    column.className = 'col-12';

    const card = document.createElement('div');
    card.className = 'card h-100';

    const header = document.createElement('div');
    header.className = 'card-header';
    header.textContent = label;

    const body = document.createElement('div');
    body.className = 'card-body';

    const element =
      kind === 'audio'
        ? document.createElement('audio')
        : document.createElement('video');
    element.className = 'w-100 rounded';
    element.autoplay = true;
    element.controls = kind === 'audio';
    element.muted = this.muted;

    if (element instanceof HTMLVideoElement) {
      element.playsInline = true;
    }

    body.appendChild(element);
    card.append(header, body);
    column.appendChild(card);
    this.container.appendChild(column);

    const item = {
      wrapper: column,
      element,
      stream: new MediaStream(),
    };

    this.items.set(key, item);
    return item;
  }

  private renderEmptyState(): void {
    this.container.innerHTML =
      `<div class="col-12"><div class="alert alert-light border mb-0">${escapeXmlTags(this.emptyText)}</div></div>`;
  }
}
