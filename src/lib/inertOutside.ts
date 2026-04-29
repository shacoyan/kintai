
interface InertRecord {
  inert: boolean;
  ariaHidden: boolean;
}

const appliedElements = new WeakMap<HTMLElement, InertRecord>();

function isInertAttributeOriginal(element: Element): boolean {
  return element.hasAttribute('inert');
}

function isAriaHiddenOriginal(element: Element): boolean {
  return element.hasAttribute('aria-hidden');
}

export function inertOutside(dialogEl: HTMLElement): () => void {
  const children = Array.from(document.body.children);
  const ownedElements: HTMLElement[] = [];

  for (const child of children) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }

    if (child === dialogEl || child.contains(dialogEl)) {
      continue;
    }

    const tagName = child.tagName.toLowerCase();
    if (tagName === 'script' || tagName === 'template' || tagName === 'style') {
      continue;
    }

    const ownedInert = !isInertAttributeOriginal(child);
    const ownedAriaHidden = !isAriaHiddenOriginal(child);

    const record: InertRecord = {
      inert: ownedInert,
      ariaHidden: ownedAriaHidden,
    };

    appliedElements.set(child, record);
    ownedElements.push(child);

    if (ownedInert) {
      (child as unknown as { inert: boolean }).inert = true;
    }

    if (ownedAriaHidden) {
      child.setAttribute('aria-hidden', 'true');
    }
  }

  return () => {
    for (const element of ownedElements) {
      const record = appliedElements.get(element);

      if (record) {
        if (record.inert) {
          (element as unknown as { inert: boolean }).inert = false;
        }
        if (record.ariaHidden) {
          element.removeAttribute('aria-hidden');
        }
        appliedElements.delete(element);
      }
    }
  };
}
